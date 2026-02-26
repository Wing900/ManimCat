/**
 * 任务存储服务
 * 改造点：
 * - 移除 InternalStateManager 依赖
 * - 使用 ioredis 直接操作 Redis
 * - 接口保持兼容，方便业务代码无感知迁移
 * - 支持 stage 存储，用于前端显示精确的处理阶段
 */

import { redisClient, REDIS_KEYS, generateRedisKey } from '../config/redis'
import { videoQueue } from '../config/bull'
import { getCancelReason, isJobCancelled } from './job-cancel-store'
import { recordUsageFinalization } from './usage-metrics'
import { JobCancelledError } from '../utils/errors'
import { createLogger } from '../utils/logger'
import type { CompletedJobResult, FailedJobResult, JobResult, ProcessingStage } from '../types'

const logger = createLogger('JobStore')

const JOB_RESULTS_GROUP = 'job-results'
const JOB_RESULT_KEY_PREFIX = `${REDIS_KEYS.JOB_RESULT}`
const JOB_STAGE_KEY_PREFIX = `${REDIS_KEYS.JOB_RESULT}:stage`
const DEFAULT_JOB_RESULT_RETENTION_HOURS = 24
type StorableJobResult = Pick<CompletedJobResult, 'status' | 'data'> | Pick<FailedJobResult, 'status' | 'data'>

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.floor(value)
}

function getJobResultRetentionSeconds(): number {
  const retentionHours = parsePositiveInteger(
    process.env.JOB_RESULT_RETENTION_HOURS,
    DEFAULT_JOB_RESULT_RETENTION_HOURS
  )
  return retentionHours * 60 * 60
}

/**
 * 使用 Redis 存储任务结果
 */
export async function storeJobResult(
  jobId: string,
  result: StorableJobResult
): Promise<void> {
  if (result.status === 'completed' && (await isJobCancelled(jobId))) {
    const reason = await getCancelReason(jobId)
    logger.warn('Skip completed result because job already cancelled', { jobId, reason })
    throw new JobCancelledError('Job cancelled', reason || undefined)
  }

  const key = generateRedisKey(JOB_RESULT_KEY_PREFIX, jobId)
  const data = {
    ...result,
    timestamp: Date.now()
  }

  try {
    const retentionSeconds = getJobResultRetentionSeconds()
    await redisClient.set(key, JSON.stringify(data))
    await redisClient.expire(key, retentionSeconds)
    logger.info('任务结果已存储', { jobId, status: result.status })

    const isCancelled = result.status === 'failed' ? Boolean(result.data.cancelReason) : false
    const renderMs = result.status === 'completed' ? result.data.timings?.total : undefined
    const outputMode = result.data.outputMode

    await recordUsageFinalization({
      jobId,
      status: result.status,
      outputMode,
      isCancelled,
      renderMs
    })
  } catch (error) {
    logger.error('存储任务结果失败', { jobId, error })
    throw error
  }
}

/**
 * 从 Redis 获取任务结果
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
    logger.error('获取任务结果失败', { jobId, error })
    return null
  }
}

/**
 * 获取 Bull 任务状态
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
    logger.error('获取 Bull 任务状态失败', { jobId, error })
    return null
  }
}

/**
 * 从 Redis 删除任务结果
 */
export async function deleteJobResult(
  jobId: string
): Promise<void> {
  const key = generateRedisKey(JOB_RESULT_KEY_PREFIX, jobId)

  try {
    await redisClient.del(key)
    logger.info('任务结果已删除', { jobId })
  } catch (error) {
    logger.error('删除任务结果失败', { jobId, error })
    throw error
  }
}

/**
 * 获取所有任务结果（用于调试/管理）
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
    logger.error('获取所有任务结果失败', { error })
    return []
  }
}

/**
 * 存储任务处理阶段
 */
export async function storeJobStage(
  jobId: string,
  stage: ProcessingStage
): Promise<void> {
  const key = generateRedisKey(JOB_STAGE_KEY_PREFIX, jobId)

  try {
    const retentionSeconds = getJobResultRetentionSeconds()
    await redisClient.set(key, stage)
    await redisClient.expire(key, retentionSeconds)
    logger.debug('任务阶段已存储', { jobId, stage })
  } catch (error) {
    logger.error('存储任务阶段失败', { jobId, error })
    throw error
  }
}

/**
 * 获取任务处理阶段
 */
export async function getJobStage(
  jobId: string
): Promise<ProcessingStage | null> {
  const key = generateRedisKey(JOB_STAGE_KEY_PREFIX, jobId)

  try {
    const stage = await redisClient.get(key)
    if (!stage) {
      return null
    }
    return stage as ProcessingStage
  } catch (error) {
    logger.error('获取任务阶段失败', { jobId, error })
    return null
  }
}

/**
 * 删除任务阶段
 */
export async function deleteJobStage(
  jobId: string
): Promise<void> {
  const key = generateRedisKey(JOB_STAGE_KEY_PREFIX, jobId)

  try {
    await redisClient.del(key)
    logger.debug('任务阶段已删除', { jobId })
  } catch (error) {
    logger.error('删除任务阶段失败', { jobId, error })
    throw error
  }
}
