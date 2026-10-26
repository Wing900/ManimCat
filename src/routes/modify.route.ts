/**
 * AI 修改路由
 * POST /api/modify - 基于现有代码进行 AI 修改并渲染
 */

import express from 'express'
import { z } from 'zod'
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
import {
  customApiConfigSchema,
  promptOverridesSchema,
  qualitySchema,
  videoConfigSchema
} from './schemas/common'
import { resolveJobTimeoutMs } from '../utils/job-timeout'
import { getRequestClientId } from '../utils/request-client-id'
import { deleteJobAccess, storeJobAccess } from '../rendering/job/job-access-store'
import { buildClassicRenderCacheKey } from '../utils/render-cache-workspace'

const router = express.Router()
const logger = createLogger('ModifyRoute')

const bodySchema = z.object({
  concept: z.string().min(1, '概念不能为空'),
  outputMode: z.enum(['video', 'image']),
  quality: qualitySchema.optional().default('high'),
  instructions: z.string().min(1, '修改意见不能为空'),
  code: z.string().min(1, '原始代码不能为空'),
  customApiConfig: customApiConfigSchema.optional(),
  promptOverrides: promptOverridesSchema.optional(),
  videoConfig: videoConfigSchema.optional(),
  renderCacheKey: z.string().min(1).optional()
})

async function handleModifyRequest(req: express.Request, res: express.Response) {
  const parsed = bodySchema.parse(req.body)
  const { concept, outputMode, quality, instructions, code, promptOverrides, videoConfig, renderCacheKey } = parsed
  const accessContext = requireAccessContext(res)
  const effectiveCustomApiConfig = requireProviderConfig(accessContext)

  if (hasPromptOverrides(promptOverrides)) {
    logger.debug('请求携带 promptOverrides', { mode: accessContext.mode })
  }

  const sanitizedConcept = concept.trim().replace(/\s+/g, ' ')
  if (sanitizedConcept.length === 0) {
    throw new ValidationError('提供的概念为空', { concept })
  }

  const sanitizedInstructions = instructions.trim()
  if (!sanitizedInstructions) {
    throw new ValidationError('修改意见不能为空', { instructions })
  }
  const clientId = getRequestClientId(req)
  const stableRenderCacheKey = buildClassicRenderCacheKey(clientId, outputMode, renderCacheKey)
  const submittedAt = new Date().toISOString()

  const jobId = uuidv4()

  logger.info('收到 AI 修改请求', {
    jobId,
    concept: sanitizedConcept,
    outputMode,
    quality,
    hasCode: !!code,
    hasCustomApiConfig: !!effectiveCustomApiConfig,
    connectionMode: accessContext.mode,
    videoConfig,
    renderCacheKey: stableRenderCacheKey
  })

  await storeJobStage(jobId, 'queued', {
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
        concept: sanitizedConcept,
        outputMode,
        quality,
        editCode: code,
        editInstructions: sanitizedInstructions,
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

  const response: GenerateResponse = {
    success: true,
    jobId,
    message: 'AI 修改已开始',
    status: 'processing',
    submittedAt
  }

  res.status(202).json(response)
}

router.post('/modify', accessMiddleware, asyncHandler(handleModifyRequest))

export default router
