/**
 * Job Cancel Store
 * 取消状态存取
 */

import { redisClient, REDIS_KEYS, generateRedisKey } from '../config/redis'

const JOB_CANCEL_KEY_PREFIX = `${REDIS_KEYS.JOB_CANCEL}`
const CANCEL_TTL_SECONDS = 7 * 24 * 60 * 60

export async function markJobCancelled(jobId: string, reason: string = 'Job cancelled'): Promise<void> {
  const key = generateRedisKey(JOB_CANCEL_KEY_PREFIX, jobId)
  const payload = {
    jobId,
    reason,
    timestamp: Date.now()
  }

  await redisClient.set(key, JSON.stringify(payload))
  await redisClient.expire(key, CANCEL_TTL_SECONDS)
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
  const key = generateRedisKey(JOB_CANCEL_KEY_PREFIX, jobId)
  return (await redisClient.get(key)) !== null
}

export async function clearJobCancelled(jobId: string): Promise<void> {
  const key = generateRedisKey(JOB_CANCEL_KEY_PREFIX, jobId)
  await redisClient.del(key)
}

export async function getCancelReason(jobId: string): Promise<string | null> {
  const key = generateRedisKey(JOB_CANCEL_KEY_PREFIX, jobId)
  const data = await redisClient.get(key)

  if (!data) {
    return null
  }

  try {
    const parsed = JSON.parse(data) as { reason?: string }
    return parsed.reason || null
  } catch {
    return null
  }
}
