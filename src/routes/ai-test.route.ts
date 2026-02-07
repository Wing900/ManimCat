/**
 * AI 测试路由
 * 用于验证后端环境变量的模型连接
 */

import express, { type Request, type Response } from 'express'
import OpenAI from 'openai'
import { z } from 'zod'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import { createLogger } from '../utils/logger'
import { testBackendAIConnection } from '../services/openai-client'

const router = express.Router()
const logger = createLogger('AiTestRoute')

const bodySchema = z.object({
  customApiConfig: z.object({
    apiUrl: z.string(),
    apiKey: z.string(),
    model: z.string()
  }).optional()
})

router.post(
  '/ai/test',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now()

    try {
      const parsed = bodySchema.parse(req.body || {})
      const result = await testBackendAIConnection(parsed.customApiConfig)
      const duration = Date.now() - start

      return res.status(200).json({
        success: true,
        model: result.model,
        content: result.content,
        duration
      })
    } catch (error) {
      const duration = Date.now() - start

      if (error instanceof OpenAI.APIError) {
        logger.error('后端 AI 测试失败', {
          status: error.status,
          code: error.code,
          type: error.type,
          message: error.message
        })

        return res.status(error.status ?? 500).json({
          success: false,
          error: error.message,
          status: error.status,
          code: error.code,
          type: error.type,
          duration
        })
      }

      logger.error('后端 AI 测试失败', { error: String(error) })

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      })
    }
  })
)

export default router
