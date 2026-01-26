/**
 * Redis Configuration
 * 支持本地开发和生产环境的 Redis 连接
 */

import Redis from 'ioredis'
import { createLogger } from '../utils/logger'

const logger = createLogger('Redis')

// Redis 配置
const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10)
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined
const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10)

/**
 * 创建 Redis 客户端实例
 */
export function createRedisClient(): Redis {
  const client = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    db: REDIS_DB,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000)
      return delay
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false
  })

  client.on('connect', () => {
    logger.info('Redis connected')
  })

  client.on('ready', () => {
    logger.info('Redis ready')
  })

  client.on('error', (err) => {
    logger.error('Redis error', { message: err.message })
  })

  client.on('close', () => {
    logger.warn('Redis connection closed')
  })

  client.on('reconnecting', () => {
    logger.warn('Redis reconnecting...')
  })

  return client
}

/**
 * Redis 键名前缀
 */
export const REDIS_KEYS = {
  JOB_RESULT: 'job:result:',
  CONCEPT_CACHE: 'concept:cache:',
  QUEUE_PREFIX: 'bull:'
} as const

/**
 * 生成 Redis 键名
 */
export function generateRedisKey(prefix: string, id: string): string {
  return `${prefix}${id}`
}

/**
 * 检查 Redis 连接状态
 */
export async function checkRedisConnection(client: Redis): Promise<boolean> {
  try {
    await client.ping()
    return true
  } catch (error) {
    logger.error('Redis connection check failed', { error })
    return false
  }
}

export const redisClient = createRedisClient()
