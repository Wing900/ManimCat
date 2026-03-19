import express from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import { ValidationError } from '../utils/errors'
import { resolveCustomApiConfigByManimcatKey } from '../utils/manimcat-routing'
import { generateProblemFramingPlan } from '../services/problem-framing'
import { customApiConfigSchema, promptOverridesSchema } from './schemas/common'
import { referenceImagesSchema } from './helpers/reference-images'

const router = express.Router()

const planStepSchema = z.object({
  title: z.string(),
  content: z.string()
})

const currentPlanSchema = z.object({
  mode: z.enum(['clarify', 'invent']),
  headline: z.string(),
  summary: z.string(),
  steps: z.array(planStepSchema).max(6),
  visualMotif: z.string(),
  designerHint: z.string()
})

const bodySchema = z.object({
  concept: z.string().min(1, '概念不能为空'),
  feedback: z.string().max(4000).optional(),
  feedbackHistory: z.array(z.string().max(4000)).max(20).optional(),
  locale: z.enum(['zh-CN', 'en-US']).optional(),
  currentPlan: currentPlanSchema.optional(),
  referenceImages: referenceImagesSchema,
  promptOverrides: promptOverridesSchema.optional(),
  customApiConfig: customApiConfigSchema.optional()
})

router.post('/problem-frame', authMiddleware, asyncHandler(async (req, res) => {
  const parsed = bodySchema.parse(req.body)
  const authenticatedManimcatApiKey = res.locals.manimcatApiKey as string | undefined
  const routedCustomApiConfig = resolveCustomApiConfigByManimcatKey(authenticatedManimcatApiKey)
  const effectiveCustomApiConfig = parsed.customApiConfig ?? routedCustomApiConfig

  if (parsed.customApiConfig) {
    const apiUrl = (parsed.customApiConfig.apiUrl || '').trim()
    const apiKey = (parsed.customApiConfig.apiKey || '').trim()
    const model = (parsed.customApiConfig.model || '').trim()
    if (!apiUrl || !apiKey || !model) {
      throw new ValidationError('自定义 API 配置不完整：需要 apiUrl/apiKey/model')
    }
  }

  if (!effectiveCustomApiConfig) {
    throw new ValidationError('未配置上游 AI：请先配置当前使用的模型')
  }

  if (!effectiveCustomApiConfig.model || !effectiveCustomApiConfig.model.trim()) {
    throw new ValidationError('后端可达，但当前 key 未启用任何模型（model 为空）')
  }

  const concept = parsed.concept.trim().replace(/\s+/g, ' ')
  if (!concept) {
    throw new ValidationError('提供的概念为空')
  }

  const plan = await generateProblemFramingPlan({
    concept,
    feedback: parsed.feedback?.trim(),
    feedbackHistory: parsed.feedbackHistory?.map((item) => item.trim()).filter(Boolean),
    currentPlan: parsed.currentPlan,
    referenceImages: parsed.referenceImages,
    promptOverrides: parsed.promptOverrides,
    customApiConfig: effectiveCustomApiConfig,
    locale: parsed.locale
  })

  res.json({
    success: true,
    plan
  })
}))

export default router
