import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudioRun, StudioRunStore } from '../../domain/types'
import type { StudioRunRow, JsonRecord } from './supabase-persistence-shared'
import { TABLES, compactObject, asOptional, asNullable, readStudioSceneId } from './supabase-persistence-shared'
import { readStudioTokenUsage } from '../../runs/token-usage'
import { canTransitionStudioRunStatus, STUDIO_RUN_ACTIVE_STATUSES } from '../../runs/run-status-transitions'

export function createSupabaseStudioRunStore(client: SupabaseClient): StudioRunStore {
  return {
    async create(run) {
      const { data, error } = await client.from(TABLES.runs).insert(toRunRow(run)).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create run: ${error.message}`)
      return fromRunRow(data as StudioRunRow)
    },
    async getById(ownerId, runId) {
      const { data, error } = await client
        .from(TABLES.runs)
        .select('*')
        .eq('id', runId)
        .eq('owner_id', ownerId)
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get run: ${error.message}`)
      return data ? fromRunRow(data as StudioRunRow) : null
    },
    async update(ownerId, runId, patch) {
      const payload = toRunPatch(patch)
      if (!Object.keys(payload).length) {
        return this.getById(ownerId, runId)
      }
      const { data, error } = await client
        .from(TABLES.runs)
        .update(payload)
        .eq('id', runId)
        .eq('owner_id', ownerId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update run: ${error.message}`)
      return data ? fromRunRow(data as StudioRunRow) : null
    },
    async transitionStatus(input) {
      // The expected status lives in the write itself (`status=in.(...)`), so two replicas
      // racing a completion and a cancellation cannot both win: the loser updates 0 rows.
      if (!canTransitionStudioRunStatus(input.from, input.patch.status)) {
        const current = await this.getById(input.ownerId, input.runId)
        return { applied: false, run: current }
      }
      const payload = toRunPatch(input.patch)
      const { data, error } = await client
        .from(TABLES.runs)
        .update(payload)
        .eq('id', input.runId)
        .eq('owner_id', input.ownerId)
        .in('status', [...input.from])
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to transition run status: ${error.message}`)
      if (data) {
        return { applied: true, run: fromRunRow(data as StudioRunRow) }
      }
      // Lost the race: report the Run that actually won so callers publish real state.
      return { applied: false, run: await this.getById(input.ownerId, input.runId) }
    },
    async listBySessionId(ownerId, sessionId) {
      const { data, error } = await client
        .from(TABLES.runs)
        .select('*')
        .eq('owner_id', ownerId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list runs: ${error.message}`)
      return (data ?? []).map((row) => fromRunRow(row as StudioRunRow))
    },
    async listBySceneId(ownerId, sceneId) {
      // The table carries owner identity, so the Scene query filters on it as well.
      const { data, error } = await client
        .from(TABLES.runs)
        .select('*')
        .eq('owner_id', ownerId)
        .eq('scene_id', sceneId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list scene runs: ${error.message}`)
      return (data ?? []).map((row) => fromRunRow(row as StudioRunRow))
    },
    async listActiveRuns(limit) {
      // Deliberately cross-owner: a Run whose owner process died is not reachable by owner, and the
      // status filter is the whole predicate. Ordered oldest first so a capped sweep takes the Runs
      // that have been claiming to be alive the longest.
      const { data, error } = await client
        .from(TABLES.runs)
        .select('*')
        .in('status', [...STUDIO_RUN_ACTIVE_STATUSES])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      if (error) throw new Error(`[StudioDB] Failed to list active runs: ${error.message}`)
      return (data ?? []).map((row) => fromRunRow(row as StudioRunRow))
    },
  }
}
function fromRunRow(row: StudioRunRow): StudioRun {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    sceneId: readStudioSceneId(row.scene_id, TABLES.runs, row.id),
    status: row.status,
    inputText: row.input_text,
    activeAgent: row.active_agent,
    createdAt: row.created_at,
    completedAt: asOptional(row.completed_at),
    error: asOptional(row.error),
    metadata: asOptional(row.metadata),
    // Stored JSON is untrusted: malformed usage resolves to undefined, never to NaN.
    tokenUsage: readStudioTokenUsage(row.token_usage)
  }
}
function toRunRow(run: StudioRun): StudioRunRow {
  return {
    id: run.id,
    owner_id: run.ownerId,
    session_id: run.sessionId,
    scene_id: asNullable(run.sceneId),
    status: run.status,
    input_text: run.inputText,
    active_agent: run.activeAgent,
    created_at: run.createdAt,
    completed_at: asNullable(run.completedAt),
    error: asNullable(run.error),
    metadata: asNullable(run.metadata),
    token_usage: run.tokenUsage ? (run.tokenUsage as unknown as JsonRecord) : null,
  }
}
function toRunPatch(patch: Partial<StudioRun>) {
  return compactObject({
    owner_id: patch.ownerId,
    session_id: patch.sessionId,
    status: patch.status,
    input_text: patch.inputText,
    active_agent: patch.activeAgent,
    created_at: patch.createdAt,
    completed_at: patch.completedAt,
    error: patch.error,
    metadata: patch.metadata,
    token_usage: patch.tokenUsage ? (patch.tokenUsage as unknown as JsonRecord) : undefined,
  })
}
