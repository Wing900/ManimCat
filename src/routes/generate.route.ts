/**
 * 生成路由
 * POST /api/generate - 创建视频生成任务
 *
 * 迁移自 src/api/generate.step.ts
 * 改动点：
 * - 使用 Express Router
 * - emit() 改为 videoQueue.add()
 * - 上游配置来自 AccessContext：CatKey 用服务端固定上游，BYOK 用请求携带的配置
 */

import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { videoQueue } from '../rendering/queue/bull-config'
import { deleteJobStage } from '../infrastructure/redis/job/redis-job-state-store'
import { storeJobStage } from '../infrastructure/redis/job/redis-job-state-store'
import { createLogger } from '../shared/logging/logger'
import { ValidationError } from '../shared/errors/errors'
import { asyncHandler } from '../http/middleware/async-route'
import { accessMiddleware } from '../http/middleware/access'
import { requireAccessContext } from '../http/access-context'
import { requireProviderConfig } from '../access'
import type { GenerateResponse } from '../types'
import { hasPromptOverrides } from '../utils/prompt-overrides'
import { sanitizeReferenceImages } from './helpers/reference-images'
import { generateBodySchema } from './schemas/generate'
import {
  normalizeGenerationConcept,
} from '../workflow/generation/request-preparation'
import { resolveJobTimeoutMs } from '../utils/job-timeout'
import { getRequestClientId } from '../utils/request-client-id'
import { deleteJobAccess, storeJobAccess } from '../rendering/job/job-access-store'
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

  const { concept, problemPlan, outputMode, quality, code, promptOverrides, videoConfig, referenceImages, renderCacheKey } = parsed
  const accessContext = requireAccessContext(res)
  const effectiveCustomApiConfig = requireProviderConfig(accessContext)

  // 清理输入
  if (hasPromptOverrides(promptOverrides)) {
    logger.debug('请求携带 promptOverrides', { mode: accessContext.mode })
  }

  const sanitizedConcept = normalizeGenerationConcept(concept)
  const queuedConcept = sanitizedConcept
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
    connectionMode: accessContext.mode,
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

  try {
    await storeJobAccess({
      jobId,
      ownerId: accessContext.ownerId,
      clientId,
    })

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
        catKeyId: accessContext.mode === 'catkey' ? accessContext.catKeyId : undefined,
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
  } catch (error) {
    await Promise.allSettled([
      deleteJobStage(jobId),
      deleteJobAccess(jobId),
    ])
    throw error
  }

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
router.post('/generate', accessMiddleware, asyncHandler(handleGenerateRequest))

export default router
