/**
 * Metrics Route
 * 系统资源监控端点
 */

import { Router, type Request, type Response } from 'express'
import { getQueueStats } from '../config/bull'
import { createLogger } from '../utils/logger'
import {
  getMemoryPeakSnapshot,
  getProcessMemorySnapshot,
  resetMemoryPeaks,
  startMemoryPeakSampler
} from './metrics/memory-peak'
import { getCPUInfo, getRuntimeInfo, getSystemMemory } from './metrics/system-metrics'
import { getDiskUsage, getRedisMemory } from './metrics/storage-metrics'
import { getUsageSummary, getUsageRetentionDays } from '../services/usage-metrics'
import { createIpRateLimiter } from '../middlewares/rate-limit'

const router = Router()
const logger = createLogger('Metrics')
const DEFAULT_USAGE_RATE_LIMIT_MAX = 30
const DEFAULT_USAGE_RATE_LIMIT_WINDOW_MS = 60_000

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  const parsed = Number(input)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.floor(parsed)
}

const usageRateLimiter = createIpRateLimiter({
  maxRequests: parsePositiveInteger(process.env.METRICS_USAGE_RATE_LIMIT_MAX, DEFAULT_USAGE_RATE_LIMIT_MAX),
  windowMs: parsePositiveInteger(process.env.METRICS_USAGE_RATE_LIMIT_WINDOW_MS, DEFAULT_USAGE_RATE_LIMIT_WINDOW_MS),
  message: '用量接口访问过于频繁，请稍后再试。'
})

const stopMemorySampler = startMemoryPeakSampler()
void stopMemorySampler

/**
 * GET /api/metrics
 * 获取系统资源监控数据
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const [queueStats, redisMemory, diskUsage] = await Promise.all([
      getQueueStats(),
      getRedisMemory(),
      getDiskUsage()
    ])

    const metrics = {
      timestamp: new Date().toISOString(),
      process: {
        memory: getProcessMemorySnapshot(),
        runtime: getRuntimeInfo()
      },
      system: {
        memory: getSystemMemory(),
        cpu: getCPUInfo()
      },
      memoryPeak: getMemoryPeakSnapshot(),
      redis: redisMemory,
      disk: diskUsage,
      queue: queueStats
    }

    res.json(metrics)
  } catch (error) {
    logger.error('Failed to get metrics', { error })
    res.status(500).json({
      error: 'Failed to collect metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * POST /api/metrics/reset
 * Reset memory peak tracking.
 */
router.post('/reset', (req: Request, res: Response) => {
  resetMemoryPeaks()
  res.json({
    status: 'ok',
    memoryPeak: getMemoryPeakSnapshot()
  })
})

/**
 * GET /api/metrics/usage?days=7
 * 获取用量统计（按天聚合）
 */
router.get('/usage', usageRateLimiter, async (req: Request, res: Response) => {
  try {
    const queryDays = Array.isArray(req.query.days) ? req.query.days[0] : req.query.days
    const parsedDays = Number.parseInt(String(queryDays || '7'), 10)
    const retentionDays = getUsageRetentionDays()
    const days = Number.isFinite(parsedDays)
      ? Math.min(Math.max(parsedDays, 1), retentionDays)
      : Math.min(7, retentionDays)

    const [usage, queue] = await Promise.all([getUsageSummary(days), getQueueStats()])

    res.json({
      timestamp: new Date().toISOString(),
      ...usage,
      queue
    })
  } catch (error) {
    logger.error('Failed to get usage metrics', { error })
    res.status(500).json({
      error: 'Failed to collect usage metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export default router
