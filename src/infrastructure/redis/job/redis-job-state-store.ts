/**
 * Redis Job State Store
 */

import { redisClient } from '../config'
import type { ProcessingStage } from '../../../rendering/job/job-types'

const STAGE_PREFIX = 'job:stage:'

export async function storeJobStage(
  jobId: string,
  stage: ProcessingStage,
  options?: {
    status?: 'queued' | 'processing' | 'completed' | 'failed'
    attempt?: number
    submittedAt?: string
  }
): Promise<void> {
  const stageKey = `${STAGE_PREFIX}${jobId}`
  await redisClient.set(stageKey, stage, 'EX', 24 * 60 * 60)

  if (options && (options.status || options.attempt || options.submittedAt)) {
    const trackingKey = `job:tracking:${jobId}`
    const updates: string[] = []
    const values: string[] = []

    if (options.status) {
      updates.push('status')
      values.push(options.status)
    }
    if (options.attempt !== undefined) {
      updates.push('attempt')
      values.push(String(options.attempt))
    }
    if (options.submittedAt) {
      updates.push('submittedAt')
      values.push(options.submittedAt)
    }
    updates.push('updatedAt')
    values.push(new Date().toISOString())
    updates.push('revision')
    values.push('0')

    const multi = redisClient.multi()
    multi.hmset(trackingKey, ...updates.flatMap((k, i) => [k, values[i]]))
    multi.expire(trackingKey, 24 * 60 * 60)
    await multi.exec()
  }
}

export async function getJobStage(jobId: string): Promise<ProcessingStage | null> {
  try {
    const stageKey = `${STAGE_PREFIX}${jobId}`
    const raw = await redisClient.get(stageKey)
    if (!raw) return null
    return raw as ProcessingStage
  } catch {
    return null
  }
}

export async function deleteJobStage(jobId: string): Promise<void> {
  const stageKey = `${STAGE_PREFIX}${jobId}`
  const trackingKey = `job:tracking:${jobId}`
  await redisClient.del(stageKey, trackingKey)
}
