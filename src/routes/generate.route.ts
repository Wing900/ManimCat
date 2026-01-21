/**
 * 生成路由
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
import { storeJobStage } from '../services/job-store'
import { createLogger } from '../utils/logger'
import { ValidationError } from '../utils/errors'
import { asyncHandler } from '../middlewares/error-handler'
import type { GenerateRequest, GenerateResponse } from '../types'

const router = express.Router()
const logger = createLogger('GenerateRoute')

// 请求体 schema（与原有保持一致）
const bodySchema = z.object({
  concept: z.string().min(1, '概念必填'),
  quality: z.enum(['low', 'medium', 'high']).optional().default('low'),
  forceRefresh: z.boolean().optional().default(false),
  /** 预生成的代码（使用自定义 AI 时） */
  code: z.string().optional()
})

/**
 * POST /api/generate
 * 提交视频生成任务
 */
router.post('/generate', asyncHandler(async (req, res) => {
  // 使用 Zod schema 验证请求体
  const { concept, quality, forceRefresh, code } = bodySchema.parse(req.body)

  // 清理输入
  const sanitizedConcept = concept.trim().replace(/\s+/g, ' ')

  if (sanitizedConcept.length === 0) {
    throw new ValidationError('提供的概念为空', { concept })
  }

  // 生成唯一的任务 ID
  const jobId = uuidv4()

  logger.info('收到动画生成请求', {
    jobId,
    concept: sanitizedConcept,
    quality,
    forceRefresh,
    hasPreGeneratedCode: !!code
  })

  // 设置初始阶段
  await storeJobStage(jobId, code ? 'rendering' : 'analyzing')

  // 添加任务到 Bull 队列（替代原来的 emit）
  await videoQueue.add(
    {
      jobId,
      concept: sanitizedConcept,
      quality,
      forceRefresh,
      preGeneratedCode: code,
      timestamp: new Date().toISOString()
    },
    {
      jobId // 使用 jobId 作为任务 ID，方便后续查询
    }
  )

  logger.info('动画请求已加入队列', { jobId })

  // 返回 202 Accepted
  const response: GenerateResponse = {
    success: true,
    jobId,
    message: code ? '视频渲染已开始' : '动画生成已开始',
    status: 'processing'
  }

  res.status(202).json(response)
}))

export default router