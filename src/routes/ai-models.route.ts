/**
 * AI 模型列表路由
 * 用于获取上游 OpenAI-compatible 服务的模型列表
 */

import express, { type Request, type Response } from 'express'
import OpenAI from 'openai'
import { z } from 'zod'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import { createLogger } from '../utils/logger'
import { listBackendAIModels } from '../services/openai-client'

const router = express.Router()
const logger = createLogger('AiModelsRoute')

const bodySchema = z.object({
  customApiConfig: z
    .object({
      apiUrl: z.string(),
      apiKey: z.string(),
      model: z.string().optional().default('')
    })
    .optional()
})

router.post(
  '/ai/models',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now()

    try {
      const parsed = bodySchema.parse(req.body || {})
      const models = await listBackendAIModels(parsed.customApiConfig)
      const duration = Date.now() - start

      return res.status(200).json({
        success: true,
        models,
        duration
      })
    } catch (error) {
      const duration = Date.now() - start

      if (error instanceof OpenAI.APIError) {
        logger.error('获取模型列表失败', {
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

      logger.error('获取模型列表失败', { error: String(error) })

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      })
    }
  })
)

export default router

