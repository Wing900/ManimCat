/**
 * AI 修改路由
 * POST /api/modify - 基于现有代码进行 AI 修改并渲染
 */

import express from 'express'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { videoQueue } from '../config/bull'
import { storeJobStage } from '../services/job-store'
import { createLogger } from '../utils/logger'
import { AuthenticationError, ValidationError } from '../utils/errors'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import type { GenerateResponse } from '../types'

const router = express.Router()
const logger = createLogger('ModifyRoute')

function extractToken(authHeader: string | string[] | undefined): string {
  if (!authHeader) return ''

  if (typeof authHeader === 'string') {
    return authHeader.replace(/^Bearer\s+/i, '')
  }
  if (Array.isArray(authHeader)) {
    return authHeader[0]?.replace(/^Bearer\s+/i, '') || ''
  }
  return ''
}

function hasPromptOverrides(promptOverrides: any): boolean {
  if (!promptOverrides) return false
  const system = promptOverrides.system || {}
  const user = promptOverrides.user || {}
  return Object.values(system).some((value) => typeof value === 'string' && value.trim().length > 0) ||
    Object.values(user).some((value) => typeof value === 'string' && value.trim().length > 0)
}

function requirePromptOverrideAuth(req: express.Request): void {
  const manimcatApiKey = process.env.MANIMCAT_API_KEY
  if (!manimcatApiKey) {
    throw new AuthenticationError('Prompt overrides require MANIMCAT_API_KEY to be set.')
  }

  const token = extractToken(req.headers?.authorization)
  if (!token || token !== manimcatApiKey) {
    throw new AuthenticationError('Prompt overrides require a valid MANIMCAT_API_KEY token.')
  }
}

const bodySchema = z.object({
  concept: z.string().min(1, '概念不能为空'),
  quality: z.enum(['low', 'medium', 'high']).optional().default('low'),
  instructions: z.string().min(1, '修改意见不能为空'),
  code: z.string().min(1, '原始代码不能为空'),
  customApiConfig: z.object({
    apiUrl: z.string(),
    apiKey: z.string(),
    model: z.string()
  }).optional(),
  promptOverrides: z.object({
    system: z.object({
      conceptDesigner: z.string().max(20000).optional(),
      codeGeneration: z.string().max(20000).optional(),
      codeRetry: z.string().max(20000).optional(),
      codeEdit: z.string().max(20000).optional()
    }).optional(),
    user: z.object({
      conceptDesigner: z.string().max(20000).optional(),
      codeGeneration: z.string().max(20000).optional(),
      codeRetryInitial: z.string().max(20000).optional(),
      codeRetryFix: z.string().max(20000).optional(),
      codeEdit: z.string().max(20000).optional()
    }).optional()
  }).optional(),
  videoConfig: z.object({
    quality: z.enum(['low', 'medium', 'high']).optional(),
    frameRate: z.number().int().min(1).max(120).optional(),
    timeout: z.number().optional()
  }).optional()
})

async function handleModifyRequest(req: express.Request, res: express.Response) {
  const parsed = bodySchema.parse(req.body)
  const { concept, quality, instructions, code, customApiConfig, promptOverrides, videoConfig } = parsed

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
    quality,
    hasCode: !!code,
    videoConfig
  })

  await storeJobStage(jobId, 'generating')

  await videoQueue.add(
    {
      jobId,
      concept: sanitizedConcept,
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

