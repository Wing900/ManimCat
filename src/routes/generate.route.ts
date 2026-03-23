/**
 * 生成路由
 * POST /api/generate - 创建视频生成任务
 *
 * 迁移自 src/api/generate.step.ts
 * 改动点：
 * - 使用 Express Router
 * - emit() 改为 videoQueue.add()
 * - Zod 验证保持不变
 * - 有预生成代码时不使用认证（前端已通过自定义 API 认证）
 */

import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { videoQueue } from '../config/bull'
import { storeJobStage } from '../services/job-store'
import { recordUsageSubmission } from '../services/usage-metrics'
import { createLogger } from '../utils/logger'
import { ValidationError } from '../utils/errors'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import type { GenerateResponse } from '../types'
import { requirePromptOverrideAuth } from '../utils/auth-utils'
import { hasPromptOverrides } from '../utils/prompt-overrides'
import { sanitizeReferenceImages } from './helpers/reference-images'
import { generateBodySchema } from './schemas/generate'
import { resolveCustomApiConfigByManimcatKey } from '../utils/manimcat-routing'
import type { ProblemFramingPlan } from '../types'
import { resolveJobTimeoutMs } from '../utils/job-timeout'
import { getRequestClientId } from '../utils/request-client-id'
import { storeJobAccess } from '../services/job-access-store'
import { buildClassicRenderCacheKey } from '../utils/render-cache-workspace'

const router = express.Router()
const logger = createLogger('GenerateRoute')

function toPreview(value: string, maxLength = 240): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

/**
 * 处理视频生成请求的核心逻辑
 */
async function handleGenerateRequest(req: express.Request, res: express.Response) {
  const parsed = generateBodySchema.parse(req.body)

  const { concept, problemPlan, outputMode, quality, code, customApiConfig, promptOverrides, videoConfig, referenceImages, renderCacheKey } = parsed
  const authenticatedManimcatApiKey = res.locals.manimcatApiKey as string | undefined
  const routedCustomApiConfig = resolveCustomApiConfigByManimcatKey(authenticatedManimcatApiKey)
  const effectiveCustomApiConfig = customApiConfig ?? routedCustomApiConfig

  if (customApiConfig) {
    const apiUrl = (customApiConfig.apiUrl || '').trim()
    const apiKey = (customApiConfig.apiKey || '').trim()
    const model = (customApiConfig.model || '').trim()
    if (!apiUrl || !apiKey || !model) {
      throw new ValidationError('自定义 API 配置不完整：需要 apiUrl/apiKey/model')
    }
  }

  if (!effectiveCustomApiConfig) {
    throw new ValidationError('未配置上游 AI：请为当前 key 配置 MANIMCAT_ROUTE_API_URLS/MANIMCAT_ROUTE_API_KEYS/MANIMCAT_ROUTE_MODELS，或在请求中提供 customApiConfig')
  }

  if (!effectiveCustomApiConfig.model || !effectiveCustomApiConfig.model.trim()) {
    throw new ValidationError('后端可达，但当前 key 未启用任何模型（model 为空）')
  }

  // 清理输入
  if (hasPromptOverrides(promptOverrides)) {
    requirePromptOverrideAuth(req)
  }

  const sanitizedConcept = concept.trim().replace(/\s+/g, ' ')
  const queuedConcept = mergeProblemPlanIntoConcept(sanitizedConcept, problemPlan)
  const sanitizedReferenceImages = sanitizeReferenceImages(referenceImages)
  const clientId = getRequestClientId(req)
  const stableRenderCacheKey = buildClassicRenderCacheKey(clientId, outputMode, renderCacheKey)
  const submittedAt = new Date().toISOString()

  if (sanitizedConcept.length === 0) {
    throw new ValidationError('提供的概念为空', { concept })
  }

  // 生成唯一的任务 ID
  const jobId = uuidv4()

  logger.info('收到动画生成请求', {
    jobId,
    conceptPreview: toPreview(queuedConcept),
    conceptLength: queuedConcept.length,
    outputMode,
    quality,
    hasProblemPlan: !!problemPlan,
    problemPlanPreview: problemPlan
      ? {
          mode: problemPlan.mode,
          headline: toPreview(problemPlan.headline, 80),
          summaryPreview: toPreview(problemPlan.summary, 120),
          stepCount: problemPlan.steps.length
        }
      : undefined,
    hasPreGeneratedCode: !!code,
    hasCustomApiConfig: !!effectiveCustomApiConfig,
    routeByManimcatKey: !customApiConfig && !!routedCustomApiConfig,
    referenceImageCount: sanitizedReferenceImages?.length || 0,
    videoConfig,
    renderCacheKey: stableRenderCacheKey
  })

  // 设置初始阶段
  await storeJobStage(jobId, code ? 'rendering' : 'analyzing', {
    status: 'queued',
    attempt: 1,
    submittedAt
  })

  // 添加任务到 Bull 队列
  await videoQueue.add(
    {
      jobId,
      concept: queuedConcept,
      problemPlan,
      outputMode,
      quality,
      referenceImages: sanitizedReferenceImages,
      preGeneratedCode: code,
      customApiConfig: effectiveCustomApiConfig,
      promptOverrides,
      videoConfig,
      clientId,
      renderCacheKey: stableRenderCacheKey,
      timestamp: submittedAt
    },
    {
      jobId,
      timeout: resolveJobTimeoutMs(videoConfig as any)
    }
  )

  if (authenticatedManimcatApiKey) {
    await storeJobAccess({
      jobId,
      apiKey: authenticatedManimcatApiKey,
      clientId,
    })
  }

  await recordUsageSubmission('generate', outputMode)

  logger.info('动画请求已加入队列', { jobId })

  const response: GenerateResponse = {
    success: true,
    jobId,
    message: code ? '渲染已开始' : '生成已开始',
    status: 'processing',
    submittedAt
  }

  res.status(202).json(response)
}

/**
 * POST /api/generate
 * 提交视频生成任务
 */
router.post('/generate', authMiddleware, asyncHandler(handleGenerateRequest))

export default router

function mergeProblemPlanIntoConcept(concept: string, problemPlan?: ProblemFramingPlan): string {
  if (!problemPlan) {
    return concept
  }

  const steps = problemPlan.steps
    .map((step, index) => `${index + 1}. ${step.title}: ${step.content}`)
    .join('\n')

  return [
    concept,
    '',
    '[Problem Framing Context]',
    `Mode: ${problemPlan.mode}`,
    `Headline: ${problemPlan.headline}`,
    `Summary: ${problemPlan.summary}`,
    'Steps:',
    steps,
    `Visual Motif: ${problemPlan.visualMotif}`,
    `Designer Hint: ${problemPlan.designerHint}`
  ].join('\n')
}
