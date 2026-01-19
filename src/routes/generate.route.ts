/**
 * Generate Route
 * POST /api/generate - 创建视频生成任务
 *
 * 迁移自 src/api/generate.step.ts
 * 改动点：
 * - 移除 Motia handler 包装，使用 Express Router
 * - emit() 改为 videoQueue.add()
 * - Zod 验证保持不变
 */

import express from 'express'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { videoQueue } from '../config/bull'
import { createLogger } from '../utils/logger'
import { ValidationError } from '../utils/errors'
import { asyncHandler } from '../middlewares/error-handler'
import type { GenerateRequest, GenerateResponse } from '../types'

const router = express.Router()
const logger = createLogger('GenerateRoute')

// Request body schema（与原有保持一致）
const bodySchema = z.object({
  concept: z.string().min(1, 'Concept is required'),
  quality: z.enum(['low', 'medium', 'high']).optional().default('low'),
  forceRefresh: z.boolean().optional().default(false)
})

/**
 * POST /api/generate
 * 提交视频生成任务
 */
router.post('/generate', asyncHandler(async (req, res) => {
  // Validate body with Zod schema
  const { concept, quality, forceRefresh } = bodySchema.parse(req.body)

  // Sanitize input
  const sanitizedConcept = concept.trim().replace(/\s+/g, ' ')

  if (sanitizedConcept.length === 0) {
    throw new ValidationError('Empty concept provided', { concept })
  }

  // Generate unique job ID
  const jobId = uuidv4()

  logger.info('Received animation request', {
    jobId,
    concept: sanitizedConcept,
    quality,
    forceRefresh
  })

  // 添加任务到 Bull 队列（替代原来的 emit）
  await videoQueue.add(
    {
      jobId,
      concept: sanitizedConcept,
      quality,
      forceRefresh,
      timestamp: new Date().toISOString()
    },
    {
      jobId // 使用 jobId 作为任务 ID，方便后续查询
    }
  )

  logger.info('Animation request added to queue', { jobId })

  // 返回 202 Accepted
  const response: GenerateResponse = {
    success: true,
    jobId,
    message: 'Animation generation started',
    status: 'processing'
  }

  res.status(202).json(response)
}))

export default router
