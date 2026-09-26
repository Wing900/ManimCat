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
import { getCancelReason } from './job-cancel-store'
import { recordUsageFinalization } from './usage-metrics'
import { JobCancelledError } from '../utils/errors'
import { createLogger } from '../utils/logger'
import type { CompletedJobResult, FailedJobResult, JobResult, ProcessingStage } from '../types'

const logger = createLogger('JobStore')

const JOB_RESULT_KEY_PREFIX = `${REDIS_KEYS.JOB_RESULT}`
const JOB_STAGE_KEY_PREFIX = `${REDIS_KEYS.JOB_RESULT}:stage`
const JOB_TRACKING_KEY_PREFIX = `${REDIS_KEYS.JOB_RESULT}:tracking`
const DEFAULT_JOB_RESULT_RETENTION_HOURS = 24
type StorableJobResult = Pick<CompletedJobResult, 'status' | 'data'> | Pick<FailedJobResult, 'status' | 'data'>
export type StoreJobResultOutcome = 'stored' | 'preserved-completed' | 'preserved-failed'

const STORE_TERMINAL_RESULT_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing then
  local ok, decoded = pcall(cjson.decode, existing)
  if ok and decoded.status == 'completed' then
    return 'preserved-completed'
  end
  if ok and decoded.status == 'failed' then
    return 'preserved-failed'
  end
end

if ARGV[1] == 'completed' and redis.call('EXISTS', KEYS[2]) == 1 then
  return 'cancelled'
end

redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 'stored'
`

const UPDATE_TRACKING_SCRIPT = `
if ARGV[2] == '1' and redis.call('EXISTS', KEYS[2]) == 1 then
  return cjson.encode({ applied = false })
end

local current = {}
local currentRaw = redis.call('GET', KEYS[1])
if currentRaw then
  local ok, decoded = pcall(cjson.decode, currentRaw)
  if ok then current = decoded end
end

local patch = cjson.decode(ARGV[1])
local next = {
  revision = (current.revision or 0) + 1,
  updatedAt = patch.updatedAt,
  submittedAt = patch.submittedAt or current.submittedAt or cjson.null,
  attempt = patch.attempt or current.attempt or 1,
  status = patch.status or current.status or 'queued',
  stage = current.stage or cjson.null
}

if patch.clearStage then
  next.stage = cjson.null
elseif patch.stage then
  next.stage = patch.stage
end

local encoded = cjson.encode(next)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[3])
if patch.clearStage then
  redis.call('DEL', KEYS[3])
elseif patch.stage then
  redis.call('SET', KEYS[3], patch.stage, 'EX', ARGV[3])
end
return cjson.encode({ applied = true, state = next })
`

export interface JobTrackingState {
  revision: number
  updatedAt: string
  submittedAt: string | null
  attempt: number
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage: ProcessingStage | null
}

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

function getJobTrackingKey(jobId: string): string {
  return generateRedisKey(JOB_TRACKING_KEY_PREFIX, jobId)
}

export async function getJobTrackingState(jobId: string): Promise<JobTrackingState | null> {
  try {
    const data = await redisClient.get(getJobTrackingKey(jobId))
    if (!data) {
      return null
    }
    return JSON.parse(data) as JobTrackingState
  } catch (error) {
    logger.error('获取任务跟踪状态失败', { jobId, error })
    return null
  }
}

async function updateJobTrackingState(
  jobId: string,
  patch: Partial<Omit<JobTrackingState, 'revision' | 'updatedAt'>>,
  options: { guardTerminalResult: boolean },
): Promise<{ applied: boolean; state?: JobTrackingState }> {
  const payload = {
    ...patch,
    updatedAt: new Date().toISOString(),
    clearStage: Object.prototype.hasOwnProperty.call(patch, 'stage') && patch.stage == null,
  }
  const raw = await redisClient.eval(
    UPDATE_TRACKING_SCRIPT,
    3,
    getJobTrackingKey(jobId),
    generateRedisKey(JOB_RESULT_KEY_PREFIX, jobId),
    generateRedisKey(JOB_STAGE_KEY_PREFIX, jobId),
    JSON.stringify(payload),
    options.guardTerminalResult ? '1' : '0',
    String(getJobResultRetentionSeconds()),
  )
  return JSON.parse(String(raw)) as { applied: boolean; state?: JobTrackingState }
}

/**
 * 使用 Redis 存储任务结果
 */
export async function storeJobResult(
  jobId: string,
  result: StorableJobResult
): Promise<StoreJobResultOutcome> {
  const key = generateRedisKey(JOB_RESULT_KEY_PREFIX, jobId)
  const cancelKey = generateRedisKey(REDIS_KEYS.JOB_CANCEL, jobId)
  const data = {
    ...result,
    timestamp: Date.now()
  }

  try {
    const retentionSeconds = getJobResultRetentionSeconds()
    const outcome = String(await redisClient.eval(
      STORE_TERMINAL_RESULT_SCRIPT,
      2,
      key,
      cancelKey,
      result.status,
      JSON.stringify(data),
      String(retentionSeconds),
    ))

    if (outcome === 'cancelled') {
      const reason = await getCancelReason(jobId)
      logger.warn('Skip completed result because job already cancelled', { jobId, reason })
      throw new JobCancelledError('Job cancelled', reason || undefined)
    }

    if (outcome !== 'stored') {
      logger.warn('Terminal job result preserved', {
        jobId,
        incomingStatus: result.status,
        outcome,
      })
      return outcome as StoreJobResultOutcome
    }

    await updateJobTrackingState(jobId, {
      status: result.status,
      stage: null
    }, { guardTerminalResult: false })
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
    return 'stored'
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
      if (key.startsWith(JOB_STAGE_KEY_PREFIX) || key.startsWith(JOB_TRACKING_KEY_PREFIX)) {
        continue
      }
      const data = await redisClient.get(key)
      if (data) {
        const parsed = JSON.parse(data) as Partial<JobResult>
        if ((parsed.status === 'completed' || parsed.status === 'failed') && parsed.data) {
          const jobId = key.substring(JOB_RESULT_KEY_PREFIX.length)
          results.push({ jobId, result: parsed as JobResult })
        }
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
  stage: ProcessingStage,
  options?: {
    status?: 'queued' | 'processing'
    attempt?: number
    submittedAt?: string
  }
): Promise<void> {
  try {
    const tracking = await updateJobTrackingState(jobId, {
      stage,
      status: options?.status ?? 'processing',
      attempt: options?.attempt,
      submittedAt: options?.submittedAt
    }, { guardTerminalResult: true })
    if (!tracking.applied) {
      logger.warn('Ignore processing stage after terminal result', { jobId, stage })
      return
    }
    logger.debug('任务阶段已存储', { jobId, stage })
  } catch (error) {
    logger.error('存储任务阶段失败', { jobId, error })
    throw error
  }
}

export async function touchJobTracking(jobId: string, attempt?: number): Promise<boolean> {
  try {
    const tracking = await updateJobTrackingState(jobId, {
      status: 'processing',
      attempt,
    }, { guardTerminalResult: true })
    return tracking.applied
  } catch (error) {
    logger.warn('刷新任务心跳失败', { jobId, error })
    return false
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
