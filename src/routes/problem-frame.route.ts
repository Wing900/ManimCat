import express from 'express'
import { z } from 'zod'
import { asyncHandler } from '../http/middleware/async-route'
import { accessMiddleware } from '../http/middleware/access'
import { requireAccessContext } from '../http/access-context'
import { requireProviderConfig } from '../access'
import { ValidationError } from '../shared/errors/errors'
import { generateProblemFramingPlan } from '../workflow/problem-framing/problem-framing'
import { customApiConfigSchema, promptOverridesSchema } from './schemas/common'
import { referenceImagesSchema } from './helpers/reference-images'
import { problemPlanSchema } from './schemas/problem-plan'

const router = express.Router()

const bodySchema = z.object({
  concept: z.string().min(1, '概念不能为空'),
  feedback: z.string().max(4000).optional(),
  feedbackHistory: z.array(z.string().max(4000)).max(20).optional(),
  locale: z.enum(['zh-CN', 'en-US']).optional(),
  currentPlan: problemPlanSchema.optional(),
  referenceImages: referenceImagesSchema,
  promptOverrides: promptOverridesSchema.optional(),
  customApiConfig: customApiConfigSchema.optional()
})

router.post('/problem-frame', accessMiddleware, asyncHandler(async (req, res) => {
  const parsed = bodySchema.parse(req.body)
  const effectiveCustomApiConfig = requireProviderConfig(requireAccessContext(res))

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
