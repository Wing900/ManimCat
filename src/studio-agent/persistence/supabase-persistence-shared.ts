import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  StudioMessage,
  StudioMessagePart,
  StudioRun,
  StudioRender,
  StudioAssistantMessage,
  StudioSession,
} from '../domain/types'
import { normalizeStudioKind, type StudioKind } from '../domain/core-types'

export const TABLES = {
  sessions: 'studio_sessions',
  messages: 'studio_messages',
  parts: 'studio_message_parts',
  runs: 'studio_runs',
  renders: 'studio_renders',
  scenes: 'studio_scenes',
} as const
export type JsonRecord = Record<string, unknown>
export type StudioSessionRow = {
  id: string
  owner_id: string
  project_id: string
  workspace_id: string | null
  parent_session_id: string | null
  agent_type: StudioSession['agentType']
  title: string
  directory: string
  permission_level: 'L4'
  permission_rules: JsonRecord[] | null
  metadata: JsonRecord | null
  created_at: string
  updated_at: string
}
export type StudioMessageRow = {
  id: string
  session_id: string
  scene_id: string | null
  role: StudioMessage['role']
  agent: StudioAssistantMessage['agent'] | null
  text: string | null
  summary: string | null
  metadata: JsonRecord | null
  created_at: string
  updated_at: string
}
export type StudioPartRow = {
  id: string
  message_id: string
  session_id: string
  type: StudioMessagePart['type']
  text: string | null
  tool: string | null
  call_id: string | null
  state: JsonRecord | null
  metadata: JsonRecord | null
  time: JsonRecord | null
  created_at: string
  updated_at: string
}
export type StudioRunRow = {
  id: string
  owner_id: string
  session_id: string
  scene_id: string | null
  status: StudioRun['status']
  input_text: string
  active_agent: StudioRun['activeAgent']
  created_at: string
  completed_at: string | null
  error: string | null
  metadata: JsonRecord | null
  // Optional on purpose: rows written before migration 009 simply have no column.
  token_usage?: JsonRecord | null
}
export type StudioRenderRow = {
  id: string
  owner_id: string
  session_id: string
  scene_id: string | null
  run_id: string | null
  kind: StudioRender['kind']
  title: string
  status: StudioRender['status']
  concept: string
  output_mode: StudioRender['outputMode']
  quality: StudioRender['quality'] | null
  job_id: string | null
  source_path: string | null
  attachments: JsonRecord[] | null
  error: string | null
  metadata: JsonRecord | null
  created_at: string
  updated_at: string
}
export type StudioSceneRow = {
  id: string
  owner_id: string
  session_id: string
  position: number
  source_path: string
  created_at: string
  updated_at: string
}
export function createCrudStore<T extends { id: string }, R extends { id: string }>(config: {
  client: SupabaseClient
  table: string
  toRow: (value: T) => R
  fromRow: (row: R) => T
  toPatch: (patch: Partial<T>) => Record<string, unknown>
  listColumn: string
  listOrderColumn: string
  listAscending?: boolean
}) {
  return {
    async create(value: T) {
      const { data, error } = await config.client.from(config.table).insert(config.toRow(value)).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create ${config.table}: ${error.message}`)
      return config.fromRow(data as R)
    },
    async getById(id: string) {
      const { data, error } = await config.client.from(config.table).select('*').eq('id', id).maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get ${config.table}: ${error.message}`)
      return data ? config.fromRow(data as R) : null
    },
    async update(id: string, patch: Partial<T>) {
      const payload = config.toPatch(patch)
      if (!Object.keys(payload).length) {
        return this.getById(id)
      }
      const { data, error } = await config.client.from(config.table).update(payload).eq('id', id).select('*').maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update ${config.table}: ${error.message}`)
      return data ? config.fromRow(data as R) : null
    },
    async listBySessionId(sessionId: string) {
      const { data, error } = await config.client
        .from(config.table)
        .select('*')
        .eq(config.listColumn, sessionId)
        .order(config.listOrderColumn, { ascending: config.listAscending ?? true })
      if (error) throw new Error(`[StudioDB] Failed to list ${config.table}: ${error.message}`)
      return (data ?? []).map((row) => config.fromRow(row as R))
    },
  }
}
export function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}
export function asOptional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
}
export function asNullable<T>(value: T | null | undefined): T | null {
  return value ?? null
}
export function asTimeRange(value: JsonRecord | null) {
  if (!value) {
    return undefined
  }

  const start = typeof value.start === 'number' ? value.start : undefined
  const end = typeof value.end === 'number' ? value.end : undefined
  if (start === undefined) {
    return undefined
  }

  return end === undefined ? { start } : { start, end }
}
export function asAttachments(value: JsonRecord[] | null): StudioRender['attachments'] | undefined {
  return value ? (value as unknown as StudioRender['attachments']) : undefined
}
export function readStudioKindFromMetadata(metadata: JsonRecord | null): StudioKind {
  const value = metadata?.studioKind
  return typeof value === 'string' ? normalizeStudioKind(value) ?? 'manim' : 'manim'
}

/**
 * Defensive read of a nullable Scene column. `NULL`/absent is the legacy Session-scoped record;
 * any other value that is not a non-empty string is malformed storage and fails closed instead
 * of silently degrading the row into a legacy record.
 */
export function readStudioSceneId(value: unknown, table: string, id: string): string | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  throw new Error(`[StudioDB] Malformed scene_id in ${table} row ${id}`)
}
