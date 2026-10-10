import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudioRender, StudioRenderStore } from '../../domain/types'
import type { StudioRenderRow, JsonRecord } from './supabase-persistence-shared'
import { TABLES, compactObject, asOptional, asNullable, asTimeRange, asAttachments, readStudioSceneId } from './supabase-persistence-shared'
import { canTransitionStudioRenderStatus } from '../../render/render-status-transitions'

export function createSupabaseStudioRenderStore(client: SupabaseClient): StudioRenderStore {
  return {
    async create(render) {
      const { data, error } = await client.from(TABLES.renders).insert(toRenderRow(render)).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create render: ${error.message}`)
      return fromRenderRow(data as StudioRenderRow)
    },
    async getById(ownerId, renderId) {
      const { data, error } = await client
        .from(TABLES.renders)
        .select('*')
        .eq('owner_id', ownerId)
        .eq('id', renderId)
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get render: ${error.message}`)
      return data ? fromRenderRow(data as StudioRenderRow) : null
    },
    async update(ownerId, renderId, patch) {
      const payload = toRenderPatch(patch)
      if (!Object.keys(payload).length) {
        return this.getById(ownerId, renderId)
      }
      const { data, error } = await client
        .from(TABLES.renders)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('owner_id', ownerId)
        .eq('id', renderId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update render: ${error.message}`)
      return data ? fromRenderRow(data as StudioRenderRow) : null
    },
    async transitionStatus(input) {
      // The expected statuses (and the expected job id) live in the write itself, so two replicas
      // racing a completion, or a late `running` observation arriving after a completion, cannot
      // both win: the loser updates 0 rows and reads back the record that actually won.
      if (!canTransitionStudioRenderStatus(input.from, input.patch.status)) {
        return { applied: false, render: await this.getById(input.ownerId, input.renderId) }
      }
      const payload = toRenderPatch(input.patch)
      let query = client
        .from(TABLES.renders)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('owner_id', input.ownerId)
        .eq('id', input.renderId)
        .in('status', [...input.from])
      if (input.expectedJobId !== undefined) {
        query = query.eq('job_id', input.expectedJobId)
      }
      const { data, error } = await query.select('*').maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to transition render status: ${error.message}`)
      if (data) {
        return { applied: true, render: fromRenderRow(data as StudioRenderRow) }
      }
      // Lost the race: report the Render that actually won so callers publish real state.
      return { applied: false, render: await this.getById(input.ownerId, input.renderId) }
    },
    async listBySessionId(ownerId, sessionId) {
      const { data, error } = await client
        .from(TABLES.renders)
        .select('*')
        .eq('owner_id', ownerId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list renders: ${error.message}`)
      return (data ?? []).map((row) => fromRenderRow(row as StudioRenderRow))
    },
    async listBySceneId(ownerId, sceneId) {
      // The table carries owner identity, so the Scene query filters on it as well.
      const { data, error } = await client
        .from(TABLES.renders)
        .select('*')
        .eq('owner_id', ownerId)
        .eq('scene_id', sceneId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list scene renders: ${error.message}`)
      return (data ?? []).map((row) => fromRenderRow(row as StudioRenderRow))
    },
  }
}
function fromRenderRow(row: StudioRenderRow): StudioRender {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    sceneId: readStudioSceneId(row.scene_id, TABLES.renders, row.id),
    runId: asOptional(row.run_id),
    kind: row.kind,
    title: row.title,
    status: row.status,
    concept: row.concept,
    outputMode: row.output_mode,
    quality: asOptional(row.quality),
    jobId: asOptional(row.job_id),
    sourcePath: asOptional(row.source_path),
    attachments: asAttachments(row.attachments),
    error: asOptional(row.error),
    metadata: asOptional(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function toRenderRow(render: StudioRender): StudioRenderRow {
  return {
    id: render.id,
    owner_id: render.ownerId,
    session_id: render.sessionId,
    scene_id: asNullable(render.sceneId),
    run_id: asNullable(render.runId),
    kind: render.kind,
    title: render.title,
    status: render.status,
    concept: render.concept,
    output_mode: render.outputMode,
    quality: asNullable(render.quality),
    job_id: asNullable(render.jobId),
    source_path: asNullable(render.sourcePath),
    attachments: render.attachments ? (render.attachments as unknown as JsonRecord[]) : null,
    error: asNullable(render.error),
    metadata: asNullable(render.metadata),
    created_at: render.createdAt,
    updated_at: render.updatedAt,
  }
}
function toRenderPatch(patch: Partial<StudioRender>) {
  return compactObject({
    owner_id: patch.ownerId,
    session_id: patch.sessionId,
    run_id: patch.runId,
    kind: patch.kind,
    title: patch.title,
    status: patch.status,
    concept: patch.concept,
    output_mode: patch.outputMode,
    quality: patch.quality,
    job_id: patch.jobId,
    source_path: patch.sourcePath,
    attachments: patch.attachments ? (patch.attachments as unknown as JsonRecord[]) : undefined,
    error: patch.error,
    metadata: patch.metadata,
  })
}
