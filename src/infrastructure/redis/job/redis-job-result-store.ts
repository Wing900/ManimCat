/**
 * Redis Job Result Store
 *
 * Also hosts getBullJobStatus (queue read) for Public Contract continuity.
 */

import { redisClient, REDIS_KEYS, generateRedisKey } from '../../../config/redis'
import { videoQueue } from '../../../config/bull'
import type { JobResult } from '../../../rendering/job/job-types'
import type { StoreJobResultOutcome } from '../../../rendering/job/job-types'
import type { JobResultStore } from '../../../rendering/job/job-result-store'

const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

const STORE_SCRIPT = `
local resultKey = KEYS[1]
local trackingKey = KEYS[2]
local status = ARGV[1]
local payload = ARGV[2]
local ttl = tonumber(ARGV[3])
if status == 'completed' and redis.call('EXISTS', resultKey) == 1 then
  return 'preserved-completed'
end
if status == 'failed' and redis.call('EXISTS', resultKey) == 1 then
  local existing = redis.call('GET', resultKey)
  if existing then
    local ok, decoded = pcall(cjson.decode, existing)
    if ok and decoded and decoded.status == 'completed' then
      return 'preserved-failed'
    end
  end
end
redis.call('SET', resultKey, payload, 'EX', ttl)
redis.call('DEL', trackingKey)
return 'stored'
`

export async function storeJobResult(
  jobId: string,
  result: Omit<JobResult, 'timestamp'> & { timestamp?: number }
): Promise<StoreJobResultOutcome> {
  const resultKey = generateRedisKey(REDIS_KEYS.JOB_RESULT, jobId)
  const trackingKey = `job:tracking:${jobId}`
  const resultWithTimestamp: JobResult = {
    ...result,
    timestamp: result.timestamp ?? Date.now(),
  } as JobResult
  const payload = JSON.stringify(resultWithTimestamp)
  const outcome = (await redisClient.eval(
    STORE_SCRIPT,
    2,
    resultKey,
    trackingKey,
    result.status,
    payload,
    String(RESULT_TTL_SECONDS)
  )) as string
  return outcome as StoreJobResultOutcome
}

export async function getJobResult(jobId: string): Promise<JobResult | null> {
  try {
    const resultKey = generateRedisKey(REDIS_KEYS.JOB_RESULT, jobId)
    const raw = await redisClient.get(resultKey)
    if (!raw) return null
    return JSON.parse(raw) as JobResult
  } catch {
    return null
  }
}

export async function deleteJobResult(jobId: string): Promise<void> {
  const resultKey = generateRedisKey(REDIS_KEYS.JOB_RESULT, jobId)
  await redisClient.del(resultKey)
}

export async function getAllJobResults(): Promise<Array<{ jobId: string; result: JobResult }>> {
  const pattern = `${REDIS_KEYS.JOB_RESULT}*`
  const keys: string[] = []
  let cursor = '0'
  do {
    const [next, batch] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = next
    keys.push(...batch)
  } while (cursor !== '0')

  const results: Array<{ jobId: string; result: JobResult }> = []
  for (const key of keys) {
    const raw = await redisClient.get(key)
    if (raw) {
      const jobId = key.slice(REDIS_KEYS.JOB_RESULT.length)
      results.push({ jobId, result: JSON.parse(raw) as JobResult })
    }
  }
  return results
}

export async function getBullJobStatus(jobId: string): Promise<'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | null> {
  try {
    const job = await videoQueue.getJob(jobId)
    if (!job) return null
    const state = await job.getState()
    const known: Set<string> = new Set(['waiting', 'active', 'completed', 'failed', 'delayed'])
    return known.has(state) ? (state as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed') : null
  } catch {
    return null
  }
}
