/**
 * AI 修改路由
 * POST /api/modify - 基于现有代码进行 AI 修改并渲染
 */

import express from 'express'
import { z } from 'zod'
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
import {
  customApiConfigSchema,
  promptOverridesSchema,
  qualitySchema,
  videoConfigSchema
} from './schemas/common'

const router = express.Router()
const logger = createLogger('ModifyRoute')

const bodySchema = z.object({
  concept: z.string().min(1, '概念不能为空'),
  outputMode: z.enum(['video', 'image']),
  quality: qualitySchema.optional().default('low'),
  instructions: z.string().min(1, '修改意见不能为空'),
  code: z.string().min(1, '原始代码不能为空'),
  customApiConfig: customApiConfigSchema.optional(),
  promptOverrides: promptOverridesSchema.optional(),
  videoConfig: videoConfigSchema.optional()
})

async function handleModifyRequest(req: express.Request, res: express.Response) {
  const parsed = bodySchema.parse(req.body)
  const { concept, outputMode, quality, instructions, code, customApiConfig, promptOverrides, videoConfig } = parsed

  if (hasPromptOverrides(promptOverrides)) {
    requirePromptOverrideAuth(req)
  }

  const sanitizedConcept = concept.trim().replace(/\s+/g, ' ')
  if (sanitizedConcept.length === 0) {
    throw new ValidationError('提供的概念为空', { concept })
  }

  const sanitizedInstructions = instructions.trim()
  if (!sanitizedInstructions) {
    throw new ValidationError('修改意见不能为空', { instructions })
  }

  const jobId = uuidv4()

  logger.info('收到 AI 修改请求', {
    jobId,
    concept: sanitizedConcept,
    outputMode,
    quality,
    hasCode: !!code,
    videoConfig
  })

  await storeJobStage(jobId, 'generating')

  await videoQueue.add(
    {
      jobId,
      concept: sanitizedConcept,
      outputMode,
      quality,
      editCode: code,
      editInstructions: sanitizedInstructions,
      customApiConfig,
      promptOverrides,
      videoConfig,
      timestamp: new Date().toISOString()
    },
    { jobId }
  )

  await recordUsageSubmission('modify', outputMode)

  const response: GenerateResponse = {
    success: true,
    jobId,
    message: 'AI 修改已开始',
    status: 'processing'
  }

  res.status(202).json(response)
}

router.post('/modify', authMiddleware, asyncHandler(handleModifyRequest))

export default router

