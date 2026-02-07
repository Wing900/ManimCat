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
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { videoQueue } from '../config/bull'
import { storeJobStage } from '../services/job-store'
import { createLogger } from '../utils/logger'
import { AuthenticationError, ValidationError } from '../utils/errors'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import type { GenerateRequest, GenerateResponse, VideoConfig } from '../types'

const router = express.Router()
const logger = createLogger('GenerateRoute')

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

// 请求体 schema（与原有保持一致）
const bodySchema = z.object({
  concept: z.string().min(1, '概念必填'),
  quality: z.enum(['low', 'medium', 'high']).optional().default('low'),
  forceRefresh: z.boolean().optional().default(false),
  /** 预生成的代码（使用自定义 AI 时） */
  code: z.string().optional(),
  /** 自定义 API 配置（用于代码修复） */
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
  /** 视频配置 */
  videoConfig: z.object({
    quality: z.enum(['low', 'medium', 'high']).optional(),
    frameRate: z.number().int().min(1).max(120).optional(),
    timeout: z.number().optional()
  }).optional()
})

/**
 * 处理视频生成请求的核心逻辑
 */
async function handleGenerateRequest(req: express.Request, res: express.Response) {
  let parsed;
  try {
    parsed = bodySchema.parse(req.body);
  } catch (error: any) {
    throw error;
  }

  const { concept, quality, forceRefresh, code, customApiConfig, promptOverrides, videoConfig } = parsed;

  // 清理输入
  if (hasPromptOverrides(promptOverrides)) {
    requirePromptOverrideAuth(req)
  }

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
    hasPreGeneratedCode: !!code,
    videoConfig
  })

  // 设置初始阶段
  await storeJobStage(jobId, code ? 'rendering' : 'analyzing')

  // 添加任务到 Bull 队列
  await videoQueue.add(
    {
      jobId,
      concept: sanitizedConcept,
      quality,
      forceRefresh,
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
    message: code ? '视频渲染已开始' : '动画生成已开始',
    status: 'processing'
  }

  res.status(202).json(response)
}

/**
 * 认证中间件
 */
function optionalAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  return authMiddleware(req, res, next)
}

/**
 * POST /api/generate
 * 提交视频生成任务
 */
router.post('/generate', optionalAuthMiddleware, asyncHandler(handleGenerateRequest))

export default router
