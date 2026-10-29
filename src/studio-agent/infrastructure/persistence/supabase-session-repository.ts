import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudioSession, StudioSessionStore } from '../../domain/types'
import type { StudioSessionRow } from './supabase-persistence-shared'
import { TABLES, compactObject, asOptional, asNullable, readStudioKindFromMetadata } from './supabase-persistence-shared'

export function createSupabaseStudioSessionStore(client: SupabaseClient): StudioSessionStore {
  return {
    async create(session) {
      const row = toSessionRow(session)
      const { data, error } = await client.from(TABLES.sessions).insert(row).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create session: ${error.message}`)
      return fromSessionRow(data as StudioSessionRow)
    },
    async getById(ownerId, sessionId) {
      const { data, error } = await client
        .from(TABLES.sessions)
        .select('*')
        .eq('id', sessionId)
        .eq('owner_id', ownerId)
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get session: ${error.message}`)
      return data ? fromSessionRow(data as StudioSessionRow) : null
    },
    async update(ownerId, sessionId, patch) {
      const payload = toSessionPatch(patch)
      if (!Object.keys(payload).length) {
        return this.getById(ownerId, sessionId)
      }
      const { data, error } = await client
        .from(TABLES.sessions)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('owner_id', ownerId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update session: ${error.message}`)
      return data ? fromSessionRow(data as StudioSessionRow) : null
    },
    async listChildren(ownerId, parentSessionId) {
      const { data, error } = await client
        .from(TABLES.sessions)
        .select('*')
        .eq('parent_session_id', parentSessionId)
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list child sessions: ${error.message}`)
      return (data ?? []).map((row) => fromSessionRow(row as StudioSessionRow))
    },
    async delete(ownerId, sessionId) {
      // One row: every child table references studio_sessions with `on delete cascade`, so the Scenes,
      // messages, parts, Runs, renders and session events go with it. The selected id is what makes the
      // answer honest — a refused write (another owner, no such id) comes back with no rows.
      const { data, error } = await client
        .from(TABLES.sessions)
        .delete()
        .eq('id', sessionId)
        .eq('owner_id', ownerId)
        .select('id')
      if (error) throw new Error(`[StudioDB] Failed to delete session: ${error.message}`)
      return (data ?? []).length > 0
    },
  }
}
function fromSessionRow(row: StudioSessionRow): StudioSession {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    workspaceId: asOptional(row.workspace_id),
    parentSessionId: asOptional(row.parent_session_id),
    studioKind: readStudioKindFromMetadata(row.metadata),
    agentType: row.agent_type,
    title: row.title,
    directory: row.directory,
    metadata: asOptional(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function toSessionRow(session: StudioSession): StudioSessionRow {
  return {
    id: session.id,
    owner_id: session.ownerId,
    project_id: session.projectId,
    workspace_id: asNullable(session.workspaceId),
    parent_session_id: asNullable(session.parentSessionId),
    agent_type: session.agentType,
    title: session.title,
    directory: session.directory,
    // Legacy columns remain required by the original migration. They are not read by the runtime.
    permission_level: 'L4',
    permission_rules: [],
    metadata: asNullable(session.metadata),
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}
function toSessionPatch(patch: Partial<StudioSession>) {
  return compactObject({
    project_id: patch.projectId,
    workspace_id: patch.workspaceId,
    parent_session_id: patch.parentSessionId,
    agent_type: patch.agentType,
    title: patch.title,
    directory: patch.directory,
    metadata: patch.metadata,
  })
}
