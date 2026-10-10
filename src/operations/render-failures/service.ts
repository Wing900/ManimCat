import { getSupabaseClient } from '../../infrastructure/database'
import { isRenderFailureFeatureEnabled } from './config'
import type {
  CreateRenderFailureEventInput,
  RenderFailureEventRow,
  RenderFailureListResult,
  RenderFailureQuery
} from './types'

const TABLE = 'render_failure_events'
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 200
const DEFAULT_EXPORT_LIMIT = 1000
const MAX_EXPORT_LIMIT = 5000

function applyBaseFilters(builder: any, query: RenderFailureQuery): any {
  let next = builder

  if (query.from) {
    next = next.gte('created_at', `${query.from}T00:00:00.000Z`)
  }
  if (query.to) {
    next = next.lte('created_at', `${query.to}T23:59:59.999Z`)
  }
  if (query.errorType) {
    next = next.eq('error_type', query.errorType)
  }
  if (query.outputMode) {
    next = next.eq('output_mode', query.outputMode)
  }
  if (query.jobId) {
    next = next.eq('job_id', query.jobId)
  }
  if (typeof query.recovered === 'boolean') {
    next = next.eq('recovered', query.recovered)
  }

  return next
}

export async function createRenderFailureEvent(
  input: CreateRenderFailureEventInput
): Promise<RenderFailureEventRow | null> {
  if (!isRenderFailureFeatureEnabled()) {
    return null
  }

  const client = getSupabaseClient()
  if (!client) {
    return null
  }

  try {
    const { data, error } = await client.from(TABLE).insert(input).select('*').single()
    if (error) {
      console.error('[RenderFailure] Failed to create record:', error.message)
      return null
    }

    return data as RenderFailureEventRow
  } catch (error) {
    console.error('[RenderFailure] Failed to create record:', error)
    return null
  }
}

export async function listRenderFailureEvents(
  query: RenderFailureQuery = {}
): Promise<RenderFailureListResult> {
  const page = Math.max(DEFAULT_PAGE, query.page ?? DEFAULT_PAGE)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE))

  const empty: RenderFailureListResult = {
    records: [],
    total: 0,
    page,
    pageSize,
    hasMore: false
  }

  if (!isRenderFailureFeatureEnabled()) {
    return empty
  }

  const client = getSupabaseClient()
  if (!client) {
    return empty
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  try {
    const countQuery = applyBaseFilters(
      client.from(TABLE).select('*', { count: 'exact', head: true }),
      query
    )
    const { count, error: countError } = await countQuery

    if (countError) {
      console.error('[RenderFailure] Failed to count records:', countError.message)
      return empty
    }

    const dataQuery = applyBaseFilters(client.from(TABLE).select('*'), query)
      .order('created_at', { ascending: false })
      .range(from, to)

    const { data, error } = await dataQuery

    if (error) {
      console.error('[RenderFailure] Failed to list records:', error.message)
      return empty
    }

    const records = (data ?? []) as RenderFailureEventRow[]
    const total = count ?? 0

    return {
      records,
      total,
      page,
      pageSize,
      hasMore: from + records.length < total
    }
  } catch (error) {
    console.error('[RenderFailure] Failed to list records:', error)
    return empty
  }
}

export async function exportRenderFailureEvents(
  query: RenderFailureQuery = {}
): Promise<RenderFailureEventRow[]> {
  if (!isRenderFailureFeatureEnabled()) {
    return []
  }

  const client = getSupabaseClient()
  if (!client) {
    return []
  }

  const limit = Math.min(MAX_EXPORT_LIMIT, Math.max(1, query.limit ?? DEFAULT_EXPORT_LIMIT))

  try {
    const dataQuery = applyBaseFilters(client.from(TABLE).select('*'), query)
      .order('created_at', { ascending: false })
      .limit(limit)

    const { data, error } = await dataQuery

    if (error) {
      console.error('[RenderFailure] Failed to export records:', error.message)
      return []
    }

    return (data ?? []) as RenderFailureEventRow[]
  } catch (error) {
    console.error('[RenderFailure] Failed to export records:', error)
    return []
  }
}

export async function markRecoveredByJobId(jobId: string): Promise<boolean> {
  if (!isRenderFailureFeatureEnabled()) {
    return false
  }

  const client = getSupabaseClient()
  if (!client) {
    return false
  }

  try {
    const { error } = await client
      .from(TABLE)
      .update({ recovered: true })
      .eq('job_id', jobId)
      .eq('recovered', false)

    if (error) {
      console.error('[RenderFailure] Failed to mark recovered:', error.message)
      return false
    }

    return true
  } catch (error) {
    console.error('[RenderFailure] Failed to mark recovered:', error)
    return false
  }
}