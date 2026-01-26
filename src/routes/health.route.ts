/**
 * 健康检查路由
 * 迁移自 src/api/health.step.ts
 *
 * 增强功能：
 * - Redis 连接状态
 * - Bull 队列状态
 * - 系统资源状态
 */

import express, { type Request, type Response } from 'express'
import { redisClient } from '../config/redis'
import { checkQueueHealth, getQueueStats } from '../config/bull'
import { appConfig } from '../config/app'
import { asyncHandler } from '../middlewares/error-handler'
import { createLogger } from '../utils/logger'
import type { HealthCheckResponse } from '../types'

const router = express.Router()
const logger = createLogger('HealthRoute')

/**
 * GET /health
 * 健康检查端点，用于监控
 */
router.get(
  '/health',
  asyncHandler(async (req: Request, res: Response) => {
    // 检查 Redis 连接
    let redisHealthy = false
    try {
      await redisClient.ping()
      redisHealthy = true
    } catch (error) {
      logger.error('Redis 健康检查失败', { error })
    }

    // 检查队列健康
    const queueHealthy = await checkQueueHealth()

    // 获取队列统计
    let stats = undefined
    if (redisHealthy && queueHealthy) {
      stats = await getQueueStats()
    }

    // 检查 OpenAI 配置
    const openaiHealthy = !!appConfig.openai.apiKey

    // 确定整体状态
    let overallStatus: 'ok' | 'degraded' | 'down' = 'ok'
    if (!redisHealthy || !queueHealthy) {
      overallStatus = 'degraded'
    }
    if (!redisHealthy && !queueHealthy) {
      overallStatus = 'down'
    }

    const response: HealthCheckResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealthy,
        queue: queueHealthy,
        openai: openaiHealthy
      },
      ...(stats && { stats })
    }

    const statusCode = overallStatus === 'ok' ? 200 : (overallStatus === 'degraded' ? 200 : 503)
    res.status(statusCode).json(response)
  })
)

export default router