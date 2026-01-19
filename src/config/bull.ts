/**
 * Bull Queue Configuration
 * 任务队列配置和初始化
 */

import { default as Bull, type Queue, type QueueOptions } from 'bull'
import Redis from 'ioredis'
import { REDIS_KEYS } from './redis'
import { createLogger } from '../utils/logger'

const logger = createLogger('BullQueue')

/**
 * Bull 队列配置选项
 */
const queueOptions: QueueOptions = {
  prefix: REDIS_KEYS.QUEUE_PREFIX,

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
    removeOnComplete: false,  // 完成后保留记录
    removeOnFail: false,      // 失败后保留记录
    timeout: 600000           // 任务超时 10 分钟
  },

  settings: {
    lockDuration: 300000,     // 锁定时长 5 分钟
    stalledInterval: 30000,   // 检查停滞任务间隔 30 秒
    maxStalledCount: 1        // 最多标记为停滞 1 次
  }
}

/**
 * 视频生成队列
 */
export const videoQueue: Queue = new Bull('video-generation', queueOptions)

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
