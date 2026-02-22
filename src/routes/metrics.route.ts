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

const router = Router()
const logger = createLogger('Metrics')

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

export default router
