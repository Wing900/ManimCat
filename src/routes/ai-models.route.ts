/**
 * AI 模型列表路由
 * 用于获取当前连接方式对应上游的模型列表
 */

import express, { type Request, type Response } from 'express'
import OpenAI from 'openai'
import { asyncHandler } from '../http/middleware/async-route'
import { accessMiddleware } from '../http/middleware/access'
import { requireAccessContext } from '../http/access-context'
import { createLogger } from '../shared/logging/logger'
import { listBackendAIModels } from '../infrastructure/ai-provider/provider-model-catalog'

const router = express.Router()
const logger = createLogger('AiModelsRoute')

router.post(
  '/ai/models',
  accessMiddleware,
  asyncHandler(async (_req: Request, res: Response) => {
    const start = Date.now()
    const accessContext = requireAccessContext(res)

    try {
      // A BYOK connection may legitimately have no upstream configured yet — the Settings page
      // fetches models to *fill* the form. That is an empty list, not an error.
      const providerConfig = accessContext.providerConfig

      if (!providerConfig) {
        return res.status(200).json({
          success: true,
          mode: accessContext.mode,
          models: [],
          warning: '尚未配置可用的 API 地址与密钥，无法获取模型列表',
          duration: Date.now() - start
        })
      }

      const models = await listBackendAIModels(providerConfig)

      return res.status(200).json({
        success: true,
        mode: accessContext.mode,
        models,
        duration: Date.now() - start
      })
    } catch (error) {
      const duration = Date.now() - start

      // An upstream rejection is a real answer about the connection, so its status and message
      // are passed through rather than flattened into a 500.
      if (error instanceof OpenAI.APIError) {
        logger.warn('获取模型列表被上游拒绝', {
          status: error.status,
          code: error.code,
          type: error.type
        })

        return res.status(error.status ?? 500).json({
          success: false,
          mode: accessContext.mode,
          error: error.message,
          status: error.status,
          code: error.code,
          type: error.type,
          duration
        })
      }

      throw error
    }
  })
)

export default router
