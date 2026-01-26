/**
 * Bull Queue Configuration
 * 任务队列配置和初始化
 */

import { default as Bull, type Queue, type QueueOptions } from 'bull'
import Redis from 'ioredis'
import { redisClient, REDIS_KEYS } from './redis'
import { createLogger } from '../utils/logger'

const logger = createLogger('BullQueue')

/**
 * Bull 队列配置选项
 */
const queueOptions: QueueOptions = {
  prefix: REDIS_KEYS.QUEUE_PREFIX,
  // ... (保持不变)

  // 为 Bull 创建专用的 Redis 客户端
  createClient: (type) => {
    const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
    const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10)
    const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined
    const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10)

    const client = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      maxRetriesPerRequest: null,  // Bull 需要
      enableReadyCheck: false      // Bull 需要
    })

    return client
  },

  // 默认任务配置
  defaultJobOptions: {
    attempts: 3,              // 失败后重试 3 次
    backoff: {
      type: 'exponential',    // 指数退避
      delay: 2000             // 初始延迟 2 秒
    },
    removeOnComplete: true,   // 完成后自动清理
    removeOnFail: true,       // 失败后自动清理
    timeout: 600000           // 任务超时 10 分钟
  },

  settings: {
    lockDuration: 600000,     // 锁定时长 10 分钟
    stalledInterval: 30000,   // 检查停滞任务间隔 30 秒
    maxStalledCount: 1        // 最多标记为停滞 1 次
  }
}

/**
 * 视频生成队列
 */
export const videoQueue: Queue = new Bull('video-generation', queueOptions)

/**
 * 启动时清理旧任务（防止后端重启后僵尸任务残留）
 */
async function cleanupStaleJobs() {
  try {
    await videoQueue.isReady()

    const stats = await getQueueStats()

    if (stats.total === 0) {
      return
    }

    // 使用 clean() 方法移除旧任务
    // age=0 表示移除所有任务，不限制时间
    // 注意：Bull 的 clean 方法状态参数是 'wait', 'active', 'completed', 'failed', 'delayed'
    const [removedWait, removedActive, removedFailed, removedCompleted, removedDelayed] = await Promise.all([
      videoQueue.clean(0, 'wait'),
      videoQueue.clean(0, 'active'),
      videoQueue.clean(0, 'failed'),
      videoQueue.clean(0, 'completed'),
      videoQueue.clean(0, 'delayed')
    ])

    const totalRemoved = (removedWait || 0) + (removedActive || 0) + (removedFailed || 0) + (removedCompleted || 0) + (removedDelayed || 0)

    if (totalRemoved > 0) {
      logger.info(`启动清理: 移除了 ${totalRemoved} 个残留队列任务`, {
        wait: removedWait,
        active: removedActive,
        failed: removedFailed,
        completed: removedCompleted,
        delayed: removedDelayed
      })
    }

    // 额外的彻底清理：删除 JobStore 存储的任务结果
    // 扫描所有以 'job:result:' 开头的 Key
    const resultKeys = await redisClient.keys(`${REDIS_KEYS.JOB_RESULT}*`)
    if (resultKeys.length > 0) {
      await redisClient.del(...resultKeys)
      logger.info(`启动清理: 删除了 ${resultKeys.length} 个历史任务结果缓存`)
    }

    if (totalRemoved === 0 && resultKeys.length === 0) {
      logger.info('启动检查: 无需清理残留数据')
    }
  } catch (error: any) {
    logger.warn('启动清理任务时遇到警告 (非致命)', { error: error?.message || String(error) })
  }
}

// 启动时执行清理
cleanupStaleJobs()

/**
 * 队列事件监听
 */
videoQueue.on('error', (error) => {
  logger.error('Queue error', { message: error.message })
})

videoQueue.on('waiting', (jobId) => {
  logger.debug(`Job ${jobId} is waiting`)
})

videoQueue.on('active', (job) => {
  logger.info(`Job ${job.id} started processing`)
})

videoQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed`)
})

videoQueue.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed`, { message: err.message })
})

videoQueue.on('progress', (job, progress) => {
  logger.debug(`Job ${job.id} progress: ${progress}%`)
})

videoQueue.on('stalled', (job) => {
  logger.warn(`Job ${job.id} stalled`)
})

/**
 * 清理队列（开发调试用）
 */
export async function cleanQueue(): Promise<void> {
  await videoQueue.clean(0, 'completed')
  await videoQueue.clean(0, 'failed')
  logger.info('Queue cleaned')
}

/**
 * 获取队列统计信息
 */
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    videoQueue.getWaitingCount(),
    videoQueue.getActiveCount(),
    videoQueue.getCompletedCount(),
    videoQueue.getFailedCount(),
    videoQueue.getDelayedCount()
  ])

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed
  }
}

/**
 * 优雅关闭队列
 */
export async function closeQueue(): Promise<void> {
  await videoQueue.close()
  logger.info('Queue closed gracefully')
}

/**
 * 检查队列健康状态
 */
export async function checkQueueHealth(): Promise<boolean> {
  try {
    const stats = await getQueueStats()
    // 如果有太多失败的任务，认为不健康
    return stats.failed < 100
  } catch (error) {
    logger.error('Queue health check failed', { error })
    return false
  }
}
