/**
 * Redis Job Tracking Store
 */

import { redisClient } from '../config'
import type { JobTrackingState } from '../../../rendering/job/job-types'

const TRACKING_PREFIX = 'job:tracking:'
const TTL_SECONDS = 24 * 60 * 60

export async function touchJobTracking(jobId: string, attempt?: number): Promise<boolean> {
  try {
    const trackingKey = `${TRACKING_PREFIX}${jobId}`
    const now = new Date().toISOString()

    const multi = redisClient.multi()
    if (attempt !== undefined) {
      multi.hset(trackingKey, 'attempt', String(attempt))
    }
    multi.hset(trackingKey, 'updatedAt', now)
    multi.hincrby(trackingKey, 'revision', 1)
    multi.expire(trackingKey, TTL_SECONDS)
    await multi.exec()
    return true
  } catch {
    return false
  }
}

export async function getJobTrackingState(jobId: string): Promise<JobTrackingState | null> {
  try {
    const trackingKey = `${TRACKING_PREFIX}${jobId}`
    const raw = await redisClient.hgetall(trackingKey)
    if (!raw || Object.keys(raw).length === 0) return null

    return {
      revision: parseInt(raw.revision ?? '0', 10),
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
      submittedAt: raw.submittedAt ?? null,
      attempt: parseInt(raw.attempt ?? '1', 10),
      status: (raw.status ?? 'queued') as JobTrackingState['status'],
      stage: (raw.stage ?? null) as JobTrackingState['stage'],
      stageStartedAt: raw.stageStartedAt ?? null,
    }
  } catch {
    return null
  }
}
