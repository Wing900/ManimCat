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
import { createLogger } from '../utils/logger'
import { ValidationError } from '../utils/errors'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import type { GenerateResponse } from '../types'
import { requirePromptOverrideAuth } from '../utils/auth-utils'
import { hasPromptOverrides } from '../utils/prompt-overrides'
import { sanitizeReferenceImages } from './helpers/reference-images'
import { generateBodySchema } from './schemas/generate'

const router = express.Router()
const logger = createLogger('GenerateRoute')

/**
 * 处理视频生成请求的核心逻辑
 */
async function handleGenerateRequest(req: express.Request, res: express.Response) {
  const parsed = generateBodySchema.parse(req.body)

  const { concept, outputMode, quality, code, customApiConfig, promptOverrides, videoConfig, referenceImages } = parsed

  // 清理输入
  if (hasPromptOverrides(promptOverrides)) {
    requirePromptOverrideAuth(req)
  }

  const sanitizedConcept = concept.trim().replace(/\s+/g, ' ')
  const sanitizedReferenceImages = sanitizeReferenceImages(referenceImages)

  if (sanitizedConcept.length === 0) {
    throw new ValidationError('提供的概念为空', { concept })
  }

  // 生成唯一的任务 ID
  const jobId = uuidv4()

  logger.info('收到动画生成请求', {
    jobId,
    concept: sanitizedConcept,
    outputMode,
    quality,
    hasPreGeneratedCode: !!code,
    referenceImageCount: sanitizedReferenceImages?.length || 0,
    videoConfig
  })

  // 设置初始阶段
  await storeJobStage(jobId, code ? 'rendering' : 'analyzing')

  // 添加任务到 Bull 队列
  await videoQueue.add(
    {
      jobId,
      concept: sanitizedConcept,
      outputMode,
      quality,
      referenceImages: sanitizedReferenceImages,
      preGeneratedCode: code,
      customApiConfig,
      promptOverrides,
      videoConfig,
      timestamp: new Date().toISOString()
    },
    {
      jobId
    }
  )

  logger.info('动画请求已加入队列', { jobId })

  const response: GenerateResponse = {
    success: true,
    jobId,
    message: code ? '渲染已开始' : '生成已开始',
    status: 'processing'
  }

  res.status(202).json(response)
}

/**
 * POST /api/generate
 * 提交视频生成任务
 */
router.post('/generate', authMiddleware, asyncHandler(handleGenerateRequest))

export default router
