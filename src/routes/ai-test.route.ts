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
import { resolveCustomApiConfigByManimcatKey } from '../utils/manimcat-routing'

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
      const duration = Date.now() - start
      const manimcatKey = res.locals.manimcatApiKey as string | undefined
      const routed = resolveCustomApiConfigByManimcatKey(manimcatKey)

      if (parsed.customApiConfig) {
        const apiUrl = (parsed.customApiConfig.apiUrl || '').trim()
        const apiKey = (parsed.customApiConfig.apiKey || '').trim()
        const model = (parsed.customApiConfig.model || '').trim()
        if (!apiUrl || !apiKey || !model) {
          return res.status(400).json({
            success: false,
            error: '自定义 API 配置不完整：需要 apiUrl/apiKey/model',
            duration
          })
        }
      }

      const effectiveConfig = parsed.customApiConfig ?? routed

      if (!effectiveConfig) {
        return res.status(200).json({
          success: true,
          mode: 'backend',
          warning:
            'Backend is reachable, but no upstream AI is configured for this key. Configure MANIMCAT_ROUTE_API_URLS/MANIMCAT_ROUTE_API_KEYS/MANIMCAT_ROUTE_MODELS or pass customApiConfig (apiUrl/apiKey/model).',
          duration
        })
      }

      if (!effectiveConfig.model || !effectiveConfig.model.trim()) {
        return res.status(200).json({
          success: true,
          mode: parsed.customApiConfig ? 'custom' : 'route',
          warning: 'Backend is reachable, but no model is available (model is empty).',
          duration
        })
      }

      const result = await testBackendAIConnection(effectiveConfig)

      return res.status(200).json({
        success: true,
        mode: parsed.customApiConfig ? 'custom' : 'route',
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
        hint: 'Configure MANIMCAT_ROUTE_API_URLS/MANIMCAT_ROUTE_API_KEYS/MANIMCAT_ROUTE_MODELS or pass customApiConfig (apiUrl/apiKey/model).',
        duration
      })
    }
  })
)

export default router
