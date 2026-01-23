/**
 * Metrics Route
 * 系统资源监控端点
 */

import { Router, type Request, type Response } from 'express'
import os from 'os'
import { promises as fs } from 'fs'
import path from 'path'
import { videoQueue, getQueueStats } from '../config/bull'
import { redisClient } from '../config/redis'
import { createLogger } from '../utils/logger'

const router = Router()
const logger = createLogger('Metrics')

/**
 * 获取进程内存使用情况
 */
function getProcessMemory() {
  const usage = process.memoryUsage()
  return {
    rss: {
      bytes: usage.rss,
      mb: Math.round(usage.rss / 1024 / 1024 * 100) / 100
    },
    heapTotal: {
      bytes: usage.heapTotal,
      mb: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100
    },
    heapUsed: {
      bytes: usage.heapUsed,
      mb: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100
    },
    external: {
      bytes: usage.external,
      mb: Math.round(usage.external / 1024 / 1024 * 100) / 100
    }
  }
}

/**
 * 获取系统内存信息
 */
function getSystemMemory() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  
  return {
    total: {
      bytes: total,
      gb: Math.round(total / 1024 / 1024 / 1024 * 100) / 100
    },
    used: {
      bytes: used,
      gb: Math.round(used / 1024 / 1024 / 1024 * 100) / 100
    },
    free: {
      bytes: free,
      gb: Math.round(free / 1024 / 1024 / 1024 * 100) / 100
    },
    usagePercent: Math.round((used / total) * 100 * 100) / 100
  }
}

/**
 * 获取 CPU 信息
 */
function getCPUInfo() {
  const cpus = os.cpus()
  const loadAvg = os.loadavg()
  
  return {
    cores: cpus.length,
    model: cpus[0]?.model || 'Unknown',
    speed: cpus[0]?.speed || 0,
    loadAverage: {
      '1min': Math.round(loadAvg[0] * 100) / 100,
      '5min': Math.round(loadAvg[1] * 100) / 100,
      '15min': Math.round(loadAvg[2] * 100) / 100
    }
  }
}

/**
 * 获取 Redis 内存信息
 */
async function getRedisMemory() {
  try {
    const info = await redisClient.info('memory')
    const lines = info.split('\r\n')
    const memoryData: Record<string, string> = {}
    
    lines.forEach(line => {
      const [key, value] = line.split(':')
      if (key && value) {
        memoryData[key] = value
      }
    })
    
    const usedMemory = parseInt(memoryData['used_memory'] || '0', 10)
    const peakMemory = parseInt(memoryData['used_memory_peak'] || '0', 10)
    
    return {
      used: {
        bytes: usedMemory,
        mb: Math.round(usedMemory / 1024 / 1024 * 100) / 100
      },
      peak: {
        bytes: peakMemory,
        mb: Math.round(peakMemory / 1024 / 1024 * 100) / 100
      },
      fragmentation: parseFloat(memoryData['mem_fragmentation_ratio'] || '0')
    }
  } catch (error) {
    logger.error('Failed to get Redis memory info', { error })
    return null
  }
}

/**
 * 获取磁盘使用情况
 */
async function getDiskUsage() {
  try {
    const videosDir = path.join(process.cwd(), 'public', 'videos')
    
    // 获取视频目录下所有文件
    let totalSize = 0
    let fileCount = 0
    
    try {
      const files = await fs.readdir(videosDir)
      
      for (const file of files) {
        if (file.endsWith('.mp4')) {
          const filePath = path.join(videosDir, file)
          const stats = await fs.stat(filePath)
          totalSize += stats.size
          fileCount++
        }
      }
    } catch (error) {
      // 目录可能不存在，忽略错误
    }
    
    return {
      videos: {
        count: fileCount,
        totalSize: {
          bytes: totalSize,
          mb: Math.round(totalSize / 1024 / 1024 * 100) / 100,
          gb: Math.round(totalSize / 1024 / 1024 / 1024 * 100) / 100
        }
      }
    }
  } catch (error) {
    logger.error('Failed to get disk usage', { error })
    return null
  }
}

/**
 * 获取运行时信息
 */
function getRuntimeInfo() {
  const uptime = process.uptime()
  
  return {
    uptime: {
      seconds: Math.round(uptime),
      formatted: formatUptime(uptime)
    },
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    pid: process.pid
  }
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${secs}s`)
  
  return parts.join(' ')
}

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
        memory: getProcessMemory(),
        runtime: getRuntimeInfo()
      },
      system: {
        memory: getSystemMemory(),
        cpu: getCPUInfo()
      },
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

export default router