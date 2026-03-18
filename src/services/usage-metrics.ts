import { redisClient } from '../config/redis'
import { getSupabaseClient } from '../database/client'
import type { OutputMode } from '../types'
import { createLogger } from '../utils/logger'

const logger = createLogger('UsageMetrics')

const USAGE_DAILY_KEY_PREFIX = 'usage:daily:'
const USAGE_FINALIZED_MARK_KEY_PREFIX = 'usage:finalized:'

const DEFAULT_USAGE_RETENTION_DAYS = 90
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

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

type ErrorCategory = 'DB_AUTH' | 'DB_SCHEMA' | 'NETWORK' | 'UNKNOWN'

function getErrorCategory(message: string): ErrorCategory {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('permission') ||
    normalized.includes('forbidden') ||
    normalized.includes('unauthorized') ||
    normalized.includes('jwt') ||
    normalized.includes('rls')
  ) {
    return 'DB_AUTH'
  }

  if (
    normalized.includes('column') ||
    normalized.includes('relation') ||
    normalized.includes('table') ||
    normalized.includes('schema') ||
    normalized.includes('does not exist') ||
    normalized.includes('invalid input syntax')
  ) {
    return 'DB_SCHEMA'
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econn') ||
    normalized.includes('socket')
  ) {
    return 'NETWORK'
  }

  return 'UNKNOWN'
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const message = error.message || ''
    return {
      name: error.name,
      message,
      category: getErrorCategory(message),
      stack: error.stack
    }
  }

  if (typeof error === 'object' && error !== null) {
    const source = error as Record<string, unknown>
    const message =
      (typeof source.message === 'string' && source.message) ||
      (typeof source.error_description === 'string' && source.error_description) ||
      (typeof source.details === 'string' && source.details) ||
      ''

    return {
      message: message || '[No message]',
      category: getErrorCategory(message),
      code: source.code,
      details: source.details,
      hint: source.hint,
      status: source.status,
      raw: source
    }
  }

  const message = String(error)
  return {
    message,
    category: getErrorCategory(message)
  }
}

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

function formatDateParts(year: number, month: number, day: number): string {
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getShanghaiDateString(date: Date): string {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS)
  return formatDateParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  )
}

function parseDateString(dateString: string): { year: number; month: number; day: number } {
  const [yearStr, monthStr, dayStr] = dateString.split('-')
  const year = Number.parseInt(yearStr || '', 10)
  const month = Number.parseInt(monthStr || '', 10)
  const day = Number.parseInt(dayStr || '', 10)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date string: ${dateString}`)
  }

  return { year, month, day }
}

function getDailyKey(dateString: string): string {
  return `${USAGE_DAILY_KEY_PREFIX}${dateString}`
}

function parseCounter(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Math.floor(value)
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
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

/**
 * 鍚屾椂鏇存柊鏁版嵁搴撳拰 Redis 鐨勮鏁板櫒
 */
async function incrementDailyCounters(dateString: string, counters: Partial<DailyCounters>): Promise<void> {
  const key = getDailyKey(dateString)
  const retentionSeconds = getUsageRetentionSeconds()

  // 1. 鍚屾鍒?Redis (淇濇寔瀹炴椂缂撳瓨)
  try {
    const tx = redisClient.multi()
    for (const field of DAILY_FIELDS) {
      const increment = counters[field]
      if (increment) {
        tx.hincrby(key, field, Math.floor(increment))
      }
    }
    tx.expire(key, retentionSeconds)
    await tx.exec()
  } catch (err) {
    logger.warn('Redis 鐢ㄩ噺缁熻鏇存柊澶辫触', { dateString, error: serializeError(err) })
  }

  // 2. 鍚屾鍒版暟鎹簱 (鎸佷箙鍖?
  const db = getSupabaseClient()
  if (db) {
    try {
      const { error } = await db.rpc('increment_usage', {
        target_date: dateString,
        inc_submitted_total: counters.submitted_total || 0,
        inc_submitted_generate: counters.submitted_generate || 0,
        inc_submitted_modify: counters.submitted_modify || 0,
        inc_completed_total: counters.completed_total || 0,
        inc_failed_total: counters.failed_total || 0,
        inc_cancelled_total: counters.cancelled_total || 0,
        inc_completed_video: counters.completed_video || 0,
        inc_completed_image: counters.completed_image || 0,
        inc_render_ms_sum: counters.render_ms_sum || 0
      })
      if (error) throw error
    } catch (err) {
      logger.error('Failed to sync usage metrics to database', { dateString, error: serializeError(err) })
    }
  }
}

export async function recordUsageSubmission(
  source: 'generate' | 'modify',
  _outputMode: OutputMode
): Promise<void> {
  const dateString = getShanghaiDateString(new Date())
  const counters: Partial<DailyCounters> = {
    submitted_total: 1,
    submitted_generate: source === 'generate' ? 1 : 0,
    submitted_modify: source === 'modify' ? 1 : 0
  }

  try {
    await incrementDailyCounters(dateString, counters)
  } catch (error) {
    logger.warn('璁板綍浠诲姟鎻愪氦鐢ㄩ噺澶辫触', { source, error: serializeError(error) })
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
    if (markResult !== 'OK') return

    const dateString = getShanghaiDateString(new Date())
    const counters: Partial<DailyCounters> = {}

    if (status === 'completed') {
      counters.completed_total = 1
      if (outputMode === 'video') counters.completed_video = 1
      else if (outputMode === 'image') counters.completed_image = 1

      if (typeof renderMs === 'number' && Number.isFinite(renderMs) && renderMs > 0) {
        counters.render_ms_sum = Math.round(renderMs)
      }
    } else {
      counters.failed_total = 1
      if (isCancelled) counters.cancelled_total = 1
    }

    await incrementDailyCounters(dateString, counters)
  } catch (error) {
    logger.warn('璁板綍浠诲姟瀹屾垚鐢ㄩ噺澶辫触', { jobId, status, error: serializeError(error) })
  }
}

function createDateWindow(rangeDays: number): string[] {
  const todayShanghai = getShanghaiDateString(new Date())
  const { year, month, day } = parseDateString(todayShanghai)
  const today = new Date(Date.UTC(year, month - 1, day))
  const dates: string[] = []

  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const target = new Date(today)
    target.setUTCDate(today.getUTCDate() - offset)
    dates.push(formatDateParts(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate()))
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

/**
 * 鑾峰彇鐢ㄩ噺姹囨€伙紝浼樺厛浠庢暟鎹簱鑾峰彇锛堟寔涔呭寲锛夛紝濡傛灉鏁版嵁搴撲笉鍙敤鍒欓€€鑰屾眰鍏舵浣跨敤 Redis
 */
export async function getUsageSummary(days: number): Promise<UsageSummary> {
  const retentionDays = getUsageRetentionDays()
  const rangeDays = Math.min(Math.max(Math.floor(days), 1), retentionDays)
  const dates = createDateWindow(rangeDays)
  
  let daily: UsageDailyPoint[] = []
  const db = getSupabaseClient()

  if (db) {
    // 1. 灏濊瘯浠庢暟鎹簱鑾峰彇
    try {
      const { data: rows, error } = await db
        .from('usage_stats')
        .select('*')
        .gte('date', dates[0])
        .lte('date', dates[dates.length - 1])
        .order('date', { ascending: true })

      if (error) throw error

      const rowMap = new Map<string, any>()
      rows?.forEach(row => rowMap.set(row.date, row))

      daily = dates.map(date => {
        const row = rowMap.get(date)
        const counters = getEmptyCounters()
        if (row) {
          counters.submitted_total = row.submitted_total
          counters.submitted_generate = row.submitted_generate
          counters.submitted_modify = row.submitted_modify
          counters.completed_total = row.completed_total
          counters.failed_total = row.failed_total
          counters.cancelled_total = row.cancelled_total
          counters.completed_video = row.completed_video
          counters.completed_image = row.completed_image
          counters.render_ms_sum = Number(row.render_ms_sum)
        }
        return buildDailyPoint(date, counters)
      })
    } catch (err) {
      logger.warn('浠庢暟鎹簱鑾峰彇鐢ㄩ噺姒傝澶辫触锛屽皾璇曞洖閫€鍒?Redis', { error: serializeError(err) })
    }
  }

  // 2. 濡傛灉鏁版嵁搴撲笉鍙敤锛屾垨鑰呰幏鍙栧け璐ワ紝鍒欎娇鐢?Redis (鍘熸湰鐨勯€昏緫)
  if (daily.length === 0) {
    const pipeline = redisClient.pipeline()
    for (const date of dates) {
      pipeline.hmget(getDailyKey(date), ...DAILY_FIELDS)
    }

    const responses = await pipeline.exec()
    daily = dates.map((date, index) => {
      const entry = responses?.[index]
      const counters = getEmptyCounters()
      const values = Array.isArray(entry?.[1]) ? (entry[1] as Array<string | null>) : []

      DAILY_FIELDS.forEach((field, fieldIndex) => {
        counters[field] = parseCounter(values[fieldIndex] ?? null)
      })

      return buildDailyPoint(date, counters)
    })
  }

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

  return { rangeDays, daily, totals }
}
