/**
 * Job Store Service
 * 改造点：
 * - 移除 InternalStateManager 依赖
 * - 使用 ioredis 直接操作 Redis
 * - 接口保持兼容，方便业务代码无感知迁移
 */

import { redisClient, REDIS_KEYS, generateRedisKey } from '../config/redis'
import { videoQueue } from '../config/bull'
import { createLogger } from '../utils/logger'
import type { JobResult } from '../types'

const logger = createLogger('JobStore')

const JOB_RESULTS_GROUP = 'job-results'
const JOB_RESULT_KEY_PREFIX = `${REDIS_KEYS.JOB_RESULT}`

/**
 * Store job result using Redis
 */
export async function storeJobResult(
  jobId: string,
  result: Omit<JobResult, 'timestamp'>
): Promise<void> {
  const key = generateRedisKey(JOB_RESULT_KEY_PREFIX, jobId)
  const data = {
    ...result,
    timestamp: Date.now()
  }

  try {
    await redisClient.set(key, JSON.stringify(data))
    // 设置过期时间：7 天后自动清理
    await redisClient.expire(key, 7 * 24 * 60 * 60)
    logger.info('Job result stored', { jobId, status: result.status })
  } catch (error) {
    logger.error('Failed to store job result', { jobId, error })
    throw error
  }
}

/**
 * Get job result from Redis
 */
export async function getJobResult(
  jobId: string
): Promise<JobResult | null> {
  const key = generateRedisKey(JOB_RESULT_KEY_PREFIX, jobId)

  try {
    const data = await redisClient.get(key)
    if (!data) {
      return null
    }
    return JSON.parse(data) as JobResult
  } catch (error) {
    logger.error('Failed to get job result', { jobId, error })
    return null
  }
}

/**
 * Get Bull job status
 * 返回任务在队列中的状态
 */
export async function getBullJobStatus(
  jobId: string
): Promise<'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | null> {
  try {
    const job = await videoQueue.getJob(jobId)
    if (!job) {
      return null
    }
    const state = await job.getState()
    // Bull 可能返回 'paused' 等状态，过滤掉
    if (state === 'paused') {
      return 'waiting'
    }
    // 只返回我们关心的状态
    if (state === 'waiting' || state === 'active' || state === 'completed' || state === 'failed' || state === 'delayed') {
      return state
    }
    return null
  } catch (error) {
    logger.error('Failed to get Bull job status', { jobId, error })
    return null
  }
}

/**
 * Delete job result from Redis
 */
export async function deleteJobResult(
  jobId: string
): Promise<void> {
  const key = generateRedisKey(JOB_RESULT_KEY_PREFIX, jobId)

  try {
    await redisClient.del(key)
    logger.info('Job result deleted', { jobId })
  } catch (error) {
    logger.error('Failed to delete job result', { jobId, error })
    throw error
  }
}

/**
 * Get all job results (for debugging/admin)
 */
export async function getAllJobResults(): Promise<Array<{ jobId: string; result: JobResult }>> {
  try {
    const keys = await redisClient.keys(`${JOB_RESULT_KEY_PREFIX}*`)
    const results: Array<{ jobId: string; result: JobResult }> = []

    for (const key of keys) {
      const data = await redisClient.get(key)
      if (data) {
        const jobId = key.substring(JOB_RESULT_KEY_PREFIX.length)
        results.push({ jobId, result: JSON.parse(data) as JobResult })
      }
    }

    return results
  } catch (error) {
    logger.error('Failed to get all job results', { error })
    return []
  }
}
