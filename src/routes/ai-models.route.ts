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
import { resolveCustomApiConfigByManimcatKey } from '../utils/manimcat-routing'

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
      const manimcatKey = res.locals.manimcatApiKey as string | undefined
      const routed = resolveCustomApiConfigByManimcatKey(manimcatKey)

      if (parsed.customApiConfig) {
        const apiUrl = (parsed.customApiConfig.apiUrl || '').trim()
        const apiKey = (parsed.customApiConfig.apiKey || '').trim()
        if (!apiUrl || !apiKey) {
          const duration = Date.now() - start
          return res.status(400).json({
            success: false,
            error: '自定义 API 配置不完整：需要 apiUrl/apiKey',
            duration
          })
        }
      }

      const effectiveConfig = parsed.customApiConfig ?? routed

      if (!effectiveConfig) {
        const duration = Date.now() - start
        return res.status(200).json({
          success: true,
          models: [],
          warning:
            'Backend is reachable, but no upstream AI is configured for this key. Configure MANIMCAT_ROUTE_API_URLS/MANIMCAT_ROUTE_API_KEYS to fetch models, or pass customApiConfig (apiUrl/apiKey).',
          duration
        })
      }

      const models = await listBackendAIModels(effectiveConfig)
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
