/**
 * Redis Job State Store
 *
 * Owns the live stage, its start time, and the settled stage history.
 * History is deliberately kept in its own key: the tracking hash is deleted
 * when a job finishes, while the history must remain available to the status
 * endpoint and to the frontend after completion.
 */

import { redisClient } from '../config'
import type { JobStageHistoryEntry, ProcessingStage } from '../../../types'

const STAGE_PREFIX = 'job:stage:'
const STAGE_HISTORY_PREFIX = 'job:stage-history:'
const STAGE_TTL_SECONDS = 24 * 60 * 60
const HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60

function stageKey(jobId: string): string {
  return `${STAGE_PREFIX}${jobId}`
}

function trackingKey(jobId: string): string {
  return `job:tracking:${jobId}`
}

function historyKey(jobId: string): string {
  return `${STAGE_HISTORY_PREFIX}${jobId}`
}

function parseHistoryEntry(raw: string): JobStageHistoryEntry | null {
  try {
    const value = JSON.parse(raw) as Partial<JobStageHistoryEntry>
    if (
      typeof value.stage !== 'string' ||
      typeof value.started_at !== 'string' ||
      typeof value.ended_at !== 'string' ||
      typeof value.duration_ms !== 'number' ||
      !Number.isFinite(value.duration_ms)
    ) {
      return null
    }
    return value as JobStageHistoryEntry
  } catch {
    return null
  }
}

/**
 * Record a live stage and settle the previous stage into history.
 * Repeating the same stage refreshes the heartbeat without creating a
 * duplicate history row or resetting the stage's start time.
 */
export async function storeJobStage(
  jobId: string,
  stage: ProcessingStage,
  options?: {
    status?: 'queued' | 'processing' | 'completed' | 'failed'
    attempt?: number
    submittedAt?: string
  }
): Promise<void> {
  const now = new Date()
  const nowIso = now.toISOString()
  const current = await redisClient.hgetall(trackingKey(jobId))
  const previousStage = (current.stage || await redisClient.get(stageKey(jobId))) as ProcessingStage | null
  const previousStartedAt = current.stageStartedAt || null
  const sameStage = previousStage === stage
  const startedAt = sameStage && previousStartedAt ? previousStartedAt : nowIso

  const multi = redisClient.multi()
  multi.set(stageKey(jobId), stage, 'EX', STAGE_TTL_SECONDS)

  if (previousStage && previousStartedAt && previousStage !== stage) {
    const previousStartedMs = Date.parse(previousStartedAt)
    if (Number.isFinite(previousStartedMs)) {
      const entry: JobStageHistoryEntry = {
        stage: previousStage,
        started_at: previousStartedAt,
        ended_at: nowIso,
        duration_ms: Math.max(0, now.getTime() - previousStartedMs),
      }
      multi.rpush(historyKey(jobId), JSON.stringify(entry))
      multi.expire(historyKey(jobId), HISTORY_TTL_SECONDS)
    }
  }

  multi.hset(
    trackingKey(jobId),
    'stage', stage,
    'stageStartedAt', startedAt,
    'updatedAt', nowIso,
    'status', options?.status ?? 'processing'
  )
  if (options?.attempt !== undefined) {
    multi.hset(trackingKey(jobId), 'attempt', String(options.attempt))
  }
  if (options?.submittedAt) {
    multi.hset(trackingKey(jobId), 'submittedAt', options.submittedAt)
  }
  multi.hincrby(trackingKey(jobId), 'revision', 1)
  multi.expire(trackingKey(jobId), STAGE_TTL_SECONDS)
  await multi.exec()
}

/**
 * Settle the current stage and clear the live stage markers.
 * The tracking hash is left for the terminal result path to read.
 */
async function finishJobStage(jobId: string): Promise<void> {
  const current = await redisClient.hgetall(trackingKey(jobId))
  const stage = current.stage as ProcessingStage | undefined
  const startedAt = current.stageStartedAt
  if (!stage || !startedAt) {
    return
  }

  const startedMs = Date.parse(startedAt)
  if (!Number.isFinite(startedMs)) {
    return
  }

  const now = new Date()
  const entry: JobStageHistoryEntry = {
    stage,
    started_at: startedAt,
    ended_at: now.toISOString(),
    duration_ms: Math.max(0, now.getTime() - startedMs),
  }

  const multi = redisClient.multi()
  multi.rpush(historyKey(jobId), JSON.stringify(entry))
  multi.expire(historyKey(jobId), HISTORY_TTL_SECONDS)
  multi.hdel(trackingKey(jobId), 'stage', 'stageStartedAt')
  await multi.exec()
}

export async function getJobStage(jobId: string): Promise<ProcessingStage | null> {
  try {
    const raw = await redisClient.get(stageKey(jobId))
    if (!raw) return null
    return raw as ProcessingStage
  } catch {
    return null
  }
}

export async function getJobStageHistory(jobId: string): Promise<JobStageHistoryEntry[]> {
  try {
    const raw = await redisClient.lrange(historyKey(jobId), 0, -1)
    return raw
      .map(parseHistoryEntry)
      .filter((entry): entry is JobStageHistoryEntry => entry !== null)
  } catch {
    return []
  }
}

/**
 * Finalize the live stage, then remove the live markers.
 * History remains under its own TTL so completed jobs can still show it.
 */
export async function deleteJobStage(jobId: string): Promise<void> {
  await finishJobStage(jobId)
  await redisClient.del(stageKey(jobId), trackingKey(jobId))
}
