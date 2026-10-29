/**
 * Access 路由
 * POST /api/access/verify — 校验当前连接方式是否真的能到达模型
 *
 * 取代原 /api/ai/test：验证职责只有一个出口，CatKey 与 BYOK 共用。
 */

import express, { type Request, type Response } from 'express'
import OpenAI from 'openai'
import { asyncHandler } from '../http/middleware/async-route'
import { accessMiddleware } from '../http/middleware/access'
import { requireAccessContext } from '../http/access-context'
import { verifyConnection } from '../access'
import { testBackendAIConnection } from '../infrastructure/ai-provider/provider-connection-probe'
import { createLogger } from '../shared/logging/logger'

const router = express.Router()
const logger = createLogger('AccessRoute')

router.post(
  '/access/verify',
  accessMiddleware,
  asyncHandler(async (_req: Request, res: Response) => {
    const accessContext = requireAccessContext(res)

    try {
      const result = await verifyConnection(accessContext, testBackendAIConnection)
      return res.status(200).json(result)
    } catch (error) {
      // An upstream rejection is the answer the caller asked for, so it is reported with the
      // provider's own status and message rather than flattened into a 500.
      if (error instanceof OpenAI.APIError) {
        logger.warn('连接验证被上游拒绝', {
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
          type: error.type
        })
      }

      throw error
    }
  })
)

export default router
