import { redisClient } from '../config/redis'
import type { OutputMode } from '../types'
import { createLogger } from '../utils/logger'

const logger = createLogger('UsageMetrics')

const USAGE_DAILY_KEY_PREFIX = 'usage:daily:'
const USAGE_FINALIZED_MARK_KEY_PREFIX = 'usage:finalized:'

const DEFAULT_USAGE_RETENTION_DAYS = 90

const DAILY_FIELDS = [
  'submitted_total',
  'submitted_generate',
  'submitted_modify',
  'completed_total',
  'failed_total',
  'cancelled_total',
  'completed_video',
  'completed_image',
  'render_ms_sum'
] as const

type DailyField = (typeof DAILY_FIELDS)[number]

type DailyCounters = Record<DailyField, number>

export interface UsageDailyPoint {
  date: string
  submittedTotal: number
  submittedGenerate: number
  submittedModify: number
  completedTotal: number
  failedTotal: number
  cancelledTotal: number
  completedVideo: number
  completedImage: number
  renderMsSum: number
  successRate: number
  avgRenderMs: number
}

export interface UsageSummary {
  rangeDays: number
  daily: UsageDailyPoint[]
  totals: {
    submittedTotal: number
    submittedGenerate: number
    submittedModify: number
    completedTotal: number
    failedTotal: number
    cancelledTotal: number
    completedVideo: number
    completedImage: number
    renderMsSum: number
    successRate: number
    avgRenderMs: number
  }
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  const parsed = Number(input)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.floor(parsed)
}

export function getUsageRetentionDays(): number {
  return parsePositiveInteger(process.env.USAGE_RETENTION_DAYS, DEFAULT_USAGE_RETENTION_DAYS)
}

function getUsageRetentionSeconds(): number {
  return getUsageRetentionDays() * 24 * 60 * 60
}

function getUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getDailyKey(dateString: string): string {
  return `${USAGE_DAILY_KEY_PREFIX}${dateString}`
}

function parseCounter(value: string | null): number {
  if (!value) {
    return 0
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return parsed
}

function buildDailyPoint(date: string, counters: DailyCounters): UsageDailyPoint {
  const submittedTotal = counters.submitted_total
  const completedTotal = counters.completed_total
  const successRate = submittedTotal > 0 ? completedTotal / submittedTotal : 0
  const avgRenderMs = completedTotal > 0 ? counters.render_ms_sum / completedTotal : 0

  return {
    date,
    submittedTotal,
    submittedGenerate: counters.submitted_generate,
    submittedModify: counters.submitted_modify,
    completedTotal,
    failedTotal: counters.failed_total,
    cancelledTotal: counters.cancelled_total,
    completedVideo: counters.completed_video,
    completedImage: counters.completed_image,
    renderMsSum: counters.render_ms_sum,
    successRate,
    avgRenderMs
  }
}

async function incrementDailyCounters(dateString: string, counters: Partial<DailyCounters>): Promise<void> {
  const key = getDailyKey(dateString)
  const retentionSeconds = getUsageRetentionSeconds()
  const tx = redisClient.multi()

  for (const field of DAILY_FIELDS) {
    const increment = counters[field]
    if (!increment) {
      continue
    }
    tx.hincrby(key, field, Math.floor(increment))
  }

  tx.expire(key, retentionSeconds)
  await tx.exec()
}

export async function recordUsageSubmission(
  source: 'generate' | 'modify',
  _outputMode: OutputMode
): Promise<void> {
  const dateString = getUtcDateString(new Date())
  const counters: Partial<DailyCounters> = {
    submitted_total: 1
  }

  if (source === 'generate') {
    counters.submitted_generate = 1
  } else {
    counters.submitted_modify = 1
  }

  try {
    await incrementDailyCounters(dateString, counters)
  } catch (error) {
    logger.warn('记录任务提交用量失败', { source, error: String(error) })
  }
}

export async function recordUsageFinalization(args: {
  jobId: string
  status: 'completed' | 'failed'
  outputMode?: OutputMode
  isCancelled?: boolean
  renderMs?: number
}): Promise<void> {
  const { jobId, status, outputMode, isCancelled = false, renderMs } = args
  const retentionSeconds = getUsageRetentionSeconds()
  const markKey = `${USAGE_FINALIZED_MARK_KEY_PREFIX}${jobId}`

  try {
    const markResult = await redisClient.set(markKey, '1', 'EX', retentionSeconds, 'NX')
    if (markResult !== 'OK') {
      return
    }

    const dateString = getUtcDateString(new Date())
    const counters: Partial<DailyCounters> = {}

    if (status === 'completed') {
      counters.completed_total = 1
      if (outputMode === 'video') {
        counters.completed_video = 1
      } else if (outputMode === 'image') {
        counters.completed_image = 1
      }

      if (typeof renderMs === 'number' && Number.isFinite(renderMs) && renderMs > 0) {
        counters.render_ms_sum = Math.round(renderMs)
      }
    } else {
      counters.failed_total = 1
      if (isCancelled) {
        counters.cancelled_total = 1
      }
    }

    await incrementDailyCounters(dateString, counters)
  } catch (error) {
    logger.warn('记录任务完成用量失败', {
      jobId,
      status,
      outputMode,
      isCancelled,
      error: String(error)
    })
  }
}

function clampRangeDays(input: number): number {
  const retentionDays = getUsageRetentionDays()
  if (!Number.isFinite(input) || input <= 0) {
    return Math.min(7, retentionDays)
  }
  return Math.min(Math.floor(input), retentionDays)
}

function createDateWindow(rangeDays: number): string[] {
  const now = new Date()
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dates: string[] = []

  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const target = new Date(todayUtc)
    target.setUTCDate(todayUtc.getUTCDate() - offset)
    dates.push(getUtcDateString(target))
  }

  return dates
}

function getEmptyCounters(): DailyCounters {
  return {
    submitted_total: 0,
    submitted_generate: 0,
    submitted_modify: 0,
    completed_total: 0,
    failed_total: 0,
    cancelled_total: 0,
    completed_video: 0,
    completed_image: 0,
    render_ms_sum: 0
  }
}

export async function getUsageSummary(days: number): Promise<UsageSummary> {
  const rangeDays = clampRangeDays(days)
  const dates = createDateWindow(rangeDays)

  const pipeline = redisClient.pipeline()
  for (const date of dates) {
    pipeline.hmget(getDailyKey(date), ...DAILY_FIELDS)
  }

  const responses = await pipeline.exec()
  const daily = dates.map((date, index) => {
    const entry = responses?.[index]
    const counters = getEmptyCounters()
    const values = Array.isArray(entry?.[1]) ? (entry[1] as Array<string | null>) : []

    DAILY_FIELDS.forEach((field, fieldIndex) => {
      counters[field] = parseCounter(values[fieldIndex] ?? null)
    })

    return buildDailyPoint(date, counters)
  })

  const totals = daily.reduce(
    (acc, current) => {
      acc.submittedTotal += current.submittedTotal
      acc.submittedGenerate += current.submittedGenerate
      acc.submittedModify += current.submittedModify
      acc.completedTotal += current.completedTotal
      acc.failedTotal += current.failedTotal
      acc.cancelledTotal += current.cancelledTotal
      acc.completedVideo += current.completedVideo
      acc.completedImage += current.completedImage
      acc.renderMsSum += current.renderMsSum
      return acc
    },
    {
      submittedTotal: 0,
      submittedGenerate: 0,
      submittedModify: 0,
      completedTotal: 0,
      failedTotal: 0,
      cancelledTotal: 0,
      completedVideo: 0,
      completedImage: 0,
      renderMsSum: 0,
      successRate: 0,
      avgRenderMs: 0
    }
  )

  totals.successRate = totals.submittedTotal > 0 ? totals.completedTotal / totals.submittedTotal : 0
  totals.avgRenderMs = totals.completedTotal > 0 ? totals.renderMsSum / totals.completedTotal : 0

  return {
    rangeDays,
    daily,
    totals
  }
}
