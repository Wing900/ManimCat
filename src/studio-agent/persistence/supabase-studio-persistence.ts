import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  StudioAssistantMessage,
  StudioMessage,
  StudioMessagePart,
  StudioMessageStore,
  StudioPartStore,
  StudioPermissionRule,
  StudioRun,
  StudioRunStore,
  StudioRender,
  StudioRenderStore,
  StudioSession,
  StudioSessionStore,
  StudioUserMessage,
} from '../domain/types'
import type { StudioPersistence } from './studio-persistence'

const TABLES = {
  sessions: 'studio_sessions',
  messages: 'studio_messages',
  parts: 'studio_message_parts',
  runs: 'studio_runs',
  renders: 'studio_renders',
} as const

type JsonRecord = Record<string, unknown>

type StudioSessionRow = {
  id: string
  owner_id: string
  project_id: string
  workspace_id: string | null
  parent_session_id: string | null
  agent_type: StudioSession['agentType']
  title: string
  directory: string
  permission_level: StudioSession['permissionLevel']
  permission_rules: StudioPermissionRule[] | null
  metadata: JsonRecord | null
  created_at: string
  updated_at: string
}

type StudioMessageRow = {
  id: string
  session_id: string
  role: StudioMessage['role']
  agent: StudioAssistantMessage['agent'] | null
  text: string | null
  summary: string | null
  metadata: JsonRecord | null
  created_at: string
  updated_at: string
}

type StudioPartRow = {
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

type StudioRunRow = {
  id: string
  owner_id: string
  session_id: string
  status: StudioRun['status']
  input_text: string
  active_agent: StudioRun['activeAgent']
  created_at: string
  completed_at: string | null
  error: string | null
  metadata: JsonRecord | null
}

type StudioRenderRow = {
  id: string
  owner_id: string
  session_id: string
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

export function createSupabaseStudioPersistence(client: SupabaseClient): StudioPersistence {
  const partStore = createSupabaseStudioPartStore(client)

  return {
    sessionStore: createSupabaseStudioSessionStore(client),
    messageStore: createSupabaseStudioMessageStore(client),
    partStore,
    runStore: createSupabaseStudioRunStore(client),
    renderStore: createSupabaseStudioRenderStore(client),
  }
}

function createSupabaseStudioSessionStore(client: SupabaseClient): StudioSessionStore {
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
  }
}

function createSupabaseStudioMessageStore(client: SupabaseClient): StudioMessageStore {
  return {
    async createAssistantMessage(message) {
      const row = toAssistantMessageRow(message)
      const { data, error } = await client.from(TABLES.messages).insert(row).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create assistant message: ${error.message}`)
      return fromMessageRow(client, data as StudioMessageRow) as Promise<StudioAssistantMessage>
    },
    async createUserMessage(message) {
      const row = toUserMessageRow(message)
      const { data, error } = await client.from(TABLES.messages).insert(row).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create user message: ${error.message}`)
      return fromMessageRow(client, data as StudioMessageRow) as Promise<StudioUserMessage>
    },
    async getById(messageId) {
      const { data, error } = await client.from(TABLES.messages).select('*').eq('id', messageId).maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get message: ${error.message}`)
      return data ? fromMessageRow(client, data as StudioMessageRow) : null
    },
    async listBySessionId(sessionId) {
      const { data, error } = await client
        .from(TABLES.messages)
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list messages: ${error.message}`)
      const rows = (data ?? []) as StudioMessageRow[]
      return Promise.all(rows.map((row) => fromMessageRow(client, row)))
    },
    async updateAssistantMessage(messageId, patch) {
      const payload = toAssistantMessagePatch(patch)
      const { data, error } = await client
        .from(TABLES.messages)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('role', 'assistant')
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update assistant message: ${error.message}`)
      return data ? (await fromMessageRow(client, data as StudioMessageRow)) as StudioAssistantMessage : null
    },
  }
}

function createSupabaseStudioPartStore(client: SupabaseClient): StudioPartStore {
  return {
    async create(part) {
      const row = toPartRow(part)
      const { data, error } = await client.from(TABLES.parts).insert(row).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create message part: ${error.message}`)
      return fromPartRow(data as StudioPartRow)
    },
    async update(partId, patch) {
      const payload = toPartPatch(patch)
      const { data, error } = await client
        .from(TABLES.parts)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', partId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update message part: ${error.message}`)
      return data ? fromPartRow(data as StudioPartRow) : null
    },
    async getById(partId) {
      const { data, error } = await client.from(TABLES.parts).select('*').eq('id', partId).maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get message part: ${error.message}`)
      return data ? fromPartRow(data as StudioPartRow) : null
    },
    async listByMessageId(messageId) {
      const { data, error } = await client
        .from(TABLES.parts)
        .select('*')
        .eq('message_id', messageId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list message parts: ${error.message}`)
      return (data ?? []).map((row) => fromPartRow(row as StudioPartRow))
    },
  }
}

function createSupabaseStudioRunStore(client: SupabaseClient): StudioRunStore {
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
  }
}

function createSupabaseStudioRenderStore(client: SupabaseClient): StudioRenderStore {
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
  }
}

function createCrudStore<T extends { id: string }, R extends { id: string }>(config: {
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

async function fromMessageRow(client: SupabaseClient, row: StudioMessageRow): Promise<StudioMessage> {
  if (row.role === 'assistant') {
    const { data, error } = await client
      .from(TABLES.parts)
      .select('*')
      .eq('message_id', row.id)
      .order('created_at', { ascending: true })
    if (error) throw new Error(`[StudioDB] Failed to load message parts: ${error.message}`)
    return {
      id: row.id,
      sessionId: row.session_id,
      role: 'assistant',
      agent: row.agent ?? 'builder',
      parts: (data ?? []).map((part) => fromPartRow(part as StudioPartRow)),
      summary: asOptional(row.summary),
      metadata: asOptional(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    role: 'user',
    text: row.text ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    permissionLevel: row.permission_level,
    permissionRules: row.permission_rules ?? [],
    metadata: asOptional(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function fromPartRow(row: StudioPartRow): StudioMessagePart {
  if (row.type === 'text') {
    return {
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      type: 'text',
      text: row.text ?? '',
      time: asTimeRange(row.time),
    }
  }

  if (row.type === 'reasoning') {
    return {
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      type: 'reasoning',
      text: row.text ?? '',
      time: asTimeRange(row.time),
    }
  }

  return {
    id: row.id,
    messageId: row.message_id,
    sessionId: row.session_id,
    type: 'tool',
    tool: row.tool ?? 'unknown',
    callId: row.call_id ?? row.id,
    state: (row.state ?? { status: 'pending', input: {}, raw: '' }) as StudioMessagePart extends infer _ ? any : never,
    metadata: asOptional(row.metadata),
  }
}

function fromRunRow(row: StudioRunRow): StudioRun {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    status: row.status,
    inputText: row.input_text,
    activeAgent: row.active_agent,
    createdAt: row.created_at,
    completedAt: asOptional(row.completed_at),
    error: asOptional(row.error),
    metadata: asOptional(row.metadata),
  }
}

function fromRenderRow(row: StudioRenderRow): StudioRender {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
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
    permission_level: session.permissionLevel,
    permission_rules: session.permissionRules,
    metadata: asNullable(session.metadata),
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}

function toAssistantMessageRow(message: StudioAssistantMessage): StudioMessageRow {
  return {
    id: message.id,
    session_id: message.sessionId,
    role: 'assistant',
    agent: message.agent,
    text: null,
    summary: asNullable(message.summary),
    metadata: asNullable(message.metadata),
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  }
}

function toUserMessageRow(message: StudioUserMessage): StudioMessageRow {
  return {
    id: message.id,
    session_id: message.sessionId,
    role: 'user',
    agent: null,
    text: message.text,
    summary: null,
    metadata: null,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  }
}

function toPartRow(part: StudioMessagePart): StudioPartRow {
  const now = new Date().toISOString()
  if (part.type === 'text' || part.type === 'reasoning') {
    return {
      id: part.id,
      message_id: part.messageId,
      session_id: part.sessionId,
      type: part.type,
      text: part.text,
      tool: null,
      call_id: null,
      state: null,
      metadata: null,
      time: part.time ? (part.time as unknown as JsonRecord) : null,
      created_at: now,
      updated_at: now,
    }
  }

  return {
    id: part.id,
    message_id: part.messageId,
    session_id: part.sessionId,
    type: 'tool',
    text: null,
    tool: part.tool,
    call_id: part.callId,
    state: part.state as unknown as JsonRecord,
    metadata: asNullable(part.metadata),
    time: null,
    created_at: now,
    updated_at: now,
  }
}

function toRunRow(run: StudioRun): StudioRunRow {
  return {
    id: run.id,
    owner_id: run.ownerId,
    session_id: run.sessionId,
    status: run.status,
    input_text: run.inputText,
    active_agent: run.activeAgent,
    created_at: run.createdAt,
    completed_at: asNullable(run.completedAt),
    error: asNullable(run.error),
    metadata: asNullable(run.metadata),
  }
}

function toRenderRow(render: StudioRender): StudioRenderRow {
  return {
    id: render.id,
    owner_id: render.ownerId,
    session_id: render.sessionId,
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

function toSessionPatch(patch: Partial<StudioSession>) {
  return compactObject({
    project_id: patch.projectId,
    workspace_id: patch.workspaceId,
    parent_session_id: patch.parentSessionId,
    agent_type: patch.agentType,
    title: patch.title,
    directory: patch.directory,
    permission_level: patch.permissionLevel,
    permission_rules: patch.permissionRules,
    metadata: patch.metadata,
  })
}

function toAssistantMessagePatch(patch: Partial<Omit<StudioAssistantMessage, 'id' | 'sessionId' | 'role'>>) {
  return compactObject({
    agent: patch.agent,
    summary: patch.summary,
    metadata: patch.metadata,
  })
}

function toPartPatch(patch: Partial<StudioMessagePart>) {
  if ('type' in patch && patch.type === 'tool') {
    return compactObject({
      type: 'tool',
      tool: patch.tool,
      call_id: patch.callId,
      state: patch.state as JsonRecord | undefined,
      metadata: patch.metadata,
      text: null,
      time: null,
      session_id: patch.sessionId,
      message_id: patch.messageId,
    })
  }

  return compactObject({
    type: patch.type,
    text: 'text' in patch ? patch.text : undefined,
    time: 'time' in patch ? patch.time : undefined,
    session_id: patch.sessionId,
    message_id: patch.messageId,
  })
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
  })
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

function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function asOptional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
}

function asNullable<T>(value: T | null | undefined): T | null {
  return value ?? null
}

function asTimeRange(value: JsonRecord | null) {
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

function asAttachments(value: JsonRecord[] | null): StudioRender['attachments'] | undefined {
  return value ? (value as unknown as StudioRender['attachments']) : undefined
}

function readStudioKindFromMetadata(metadata: JsonRecord | null): StudioSession['studioKind'] | undefined {
  const value = metadata?.studioKind
  return value === 'plot' || value === 'manim' ? value : undefined
}
