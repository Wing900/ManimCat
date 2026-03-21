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
  StudioSession,
  StudioSessionStore,
  StudioTask,
  StudioTaskStore,
  StudioUserMessage,
  StudioWork,
  StudioWorkResult,
  StudioWorkResultStore,
  StudioWorkStore,
} from '../domain/types'
import type { StudioPersistence } from './studio-persistence'

const TABLES = {
  sessions: 'studio_sessions',
  messages: 'studio_messages',
  parts: 'studio_message_parts',
  runs: 'studio_runs',
  tasks: 'studio_tasks',
  works: 'studio_works',
  workResults: 'studio_work_results',
} as const

type JsonRecord = Record<string, unknown>

type StudioSessionRow = {
  id: string
  project_id: string
  workspace_id: string | null
  parent_session_id: string | null
  agent_type: StudioSession['agentType']
  title: string
  directory: string
  permission_level: StudioSession['permissionLevel']
  permission_rules: StudioPermissionRule[] | null
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
  session_id: string
  status: StudioRun['status']
  input_text: string
  active_agent: StudioRun['activeAgent']
  created_at: string
  completed_at: string | null
  error: string | null
}

type StudioTaskRow = {
  id: string
  session_id: string
  run_id: string | null
  work_id: string | null
  type: StudioTask['type']
  status: StudioTask['status']
  title: string
  detail: string | null
  metadata: JsonRecord | null
  created_at: string
  updated_at: string
}

type StudioWorkRow = {
  id: string
  session_id: string
  run_id: string | null
  type: StudioWork['type']
  title: string
  status: StudioWork['status']
  latest_task_id: string | null
  current_result_id: string | null
  metadata: JsonRecord | null
  created_at: string
  updated_at: string
}

type StudioWorkResultRow = {
  id: string
  work_id: string
  kind: StudioWorkResult['kind']
  summary: string
  attachments: JsonRecord[] | null
  metadata: JsonRecord | null
  created_at: string
}

export function createSupabaseStudioPersistence(client: SupabaseClient): StudioPersistence {
  const partStore = createSupabaseStudioPartStore(client)

  return {
    sessionStore: createSupabaseStudioSessionStore(client),
    messageStore: createSupabaseStudioMessageStore(client),
    partStore,
    runStore: createSupabaseStudioRunStore(client),
    taskStore: createSupabaseStudioTaskStore(client),
    workStore: createSupabaseStudioWorkStore(client),
    workResultStore: createSupabaseStudioWorkResultStore(client),
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
    async getById(sessionId) {
      const { data, error } = await client.from(TABLES.sessions).select('*').eq('id', sessionId).maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get session: ${error.message}`)
      return data ? fromSessionRow(data as StudioSessionRow) : null
    },
    async update(sessionId, patch) {
      const payload = toSessionPatch(patch)
      if (!Object.keys(payload).length) {
        return this.getById(sessionId)
      }
      const { data, error } = await client
        .from(TABLES.sessions)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update session: ${error.message}`)
      return data ? fromSessionRow(data as StudioSessionRow) : null
    },
    async listChildren(parentSessionId) {
      const { data, error } = await client
        .from(TABLES.sessions)
        .select('*')
        .eq('parent_session_id', parentSessionId)
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
  return createCrudStore<StudioRun, StudioRunRow>({
    client,
    table: TABLES.runs,
    toRow: toRunRow,
    fromRow: fromRunRow,
    toPatch: toRunPatch,
    listColumn: 'session_id',
    listOrderColumn: 'created_at',
  })
}

function createSupabaseStudioTaskStore(client: SupabaseClient): StudioTaskStore {
  return createCrudStore<StudioTask, StudioTaskRow>({
    client,
    table: TABLES.tasks,
    toRow: toTaskRow,
    fromRow: fromTaskRow,
    toPatch: toTaskPatch,
    listColumn: 'session_id',
    listOrderColumn: 'updated_at',
    listAscending: false,
  })
}

function createSupabaseStudioWorkStore(client: SupabaseClient): StudioWorkStore {
  return createCrudStore<StudioWork, StudioWorkRow>({
    client,
    table: TABLES.works,
    toRow: toWorkRow,
    fromRow: fromWorkRow,
    toPatch: toWorkPatch,
    listColumn: 'session_id',
    listOrderColumn: 'updated_at',
    listAscending: false,
  })
}

function createSupabaseStudioWorkResultStore(client: SupabaseClient): StudioWorkResultStore {
  return {
    async create(result) {
      const row = toWorkResultRow(result)
      const { data, error } = await client.from(TABLES.workResults).insert(row).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create work result: ${error.message}`)
      return fromWorkResultRow(data as StudioWorkResultRow)
    },
    async getById(resultId) {
      const { data, error } = await client.from(TABLES.workResults).select('*').eq('id', resultId).maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get work result: ${error.message}`)
      return data ? fromWorkResultRow(data as StudioWorkResultRow) : null
    },
    async update(resultId, patch) {
      const payload = toWorkResultPatch(patch)
      const { data, error } = await client
        .from(TABLES.workResults)
        .update(payload)
        .eq('id', resultId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to update work result: ${error.message}`)
      return data ? fromWorkResultRow(data as StudioWorkResultRow) : null
    },
    async listByWorkId(workId) {
      const { data, error } = await client
        .from(TABLES.workResults)
        .select('*')
        .eq('work_id', workId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list work results: ${error.message}`)
      return (data ?? []).map((row) => fromWorkResultRow(row as StudioWorkResultRow))
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
      summary: row.summary ?? undefined,
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
    projectId: row.project_id,
    workspaceId: row.workspace_id ?? undefined,
    parentSessionId: row.parent_session_id ?? undefined,
    agentType: row.agent_type,
    title: row.title,
    directory: row.directory,
    permissionLevel: row.permission_level,
    permissionRules: row.permission_rules ?? [],
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
    metadata: row.metadata ?? undefined,
  }
}

function fromRunRow(row: StudioRunRow): StudioRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    inputText: row.input_text,
    activeAgent: row.active_agent,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  }
}

function fromTaskRow(row: StudioTaskRow): StudioTask {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    workId: row.work_id ?? undefined,
    type: row.type,
    status: row.status,
    title: row.title,
    detail: row.detail ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function fromWorkRow(row: StudioWorkRow): StudioWork {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    type: row.type,
    title: row.title,
    status: row.status,
    latestTaskId: row.latest_task_id ?? undefined,
    currentResultId: row.current_result_id ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function fromWorkResultRow(row: StudioWorkResultRow): StudioWorkResult {
  return {
    id: row.id,
    workId: row.work_id,
    kind: row.kind,
    summary: row.summary,
    attachments: asAttachments(row.attachments),
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
  }
}

function toSessionRow(session: StudioSession): StudioSessionRow {
  return {
    id: session.id,
    project_id: session.projectId,
    workspace_id: session.workspaceId ?? null,
    parent_session_id: session.parentSessionId ?? null,
    agent_type: session.agentType,
    title: session.title,
    directory: session.directory,
    permission_level: session.permissionLevel,
    permission_rules: session.permissionRules,
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
    summary: message.summary ?? null,
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
    metadata: part.metadata ?? null,
    time: null,
    created_at: now,
    updated_at: now,
  }
}

function toRunRow(run: StudioRun): StudioRunRow {
  return {
    id: run.id,
    session_id: run.sessionId,
    status: run.status,
    input_text: run.inputText,
    active_agent: run.activeAgent,
    created_at: run.createdAt,
    completed_at: run.completedAt ?? null,
    error: run.error ?? null,
  }
}

function toTaskRow(task: StudioTask): StudioTaskRow {
  return {
    id: task.id,
    session_id: task.sessionId,
    run_id: task.runId ?? null,
    work_id: task.workId ?? null,
    type: task.type,
    status: task.status,
    title: task.title,
    detail: task.detail ?? null,
    metadata: task.metadata ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  }
}

function toWorkRow(work: StudioWork): StudioWorkRow {
  return {
    id: work.id,
    session_id: work.sessionId,
    run_id: work.runId ?? null,
    type: work.type,
    title: work.title,
    status: work.status,
    latest_task_id: work.latestTaskId ?? null,
    current_result_id: work.currentResultId ?? null,
    metadata: work.metadata ?? null,
    created_at: work.createdAt,
    updated_at: work.updatedAt,
  }
}

function toWorkResultRow(result: StudioWorkResult): StudioWorkResultRow {
  return {
    id: result.id,
    work_id: result.workId,
    kind: result.kind,
    summary: result.summary,
    attachments: result.attachments ? (result.attachments as unknown as JsonRecord[]) : null,
    metadata: result.metadata ?? null,
    created_at: result.createdAt,
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
  })
}

function toAssistantMessagePatch(patch: Partial<Omit<StudioAssistantMessage, 'id' | 'sessionId' | 'role'>>) {
  return compactObject({
    agent: patch.agent,
    summary: patch.summary,
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
    session_id: patch.sessionId,
    status: patch.status,
    input_text: patch.inputText,
    active_agent: patch.activeAgent,
    created_at: patch.createdAt,
    completed_at: patch.completedAt,
    error: patch.error,
  })
}

function toTaskPatch(patch: Partial<StudioTask>) {
  return compactObject({
    session_id: patch.sessionId,
    run_id: patch.runId,
    work_id: patch.workId,
    type: patch.type,
    status: patch.status,
    title: patch.title,
    detail: patch.detail,
    metadata: patch.metadata,
    created_at: patch.createdAt,
    updated_at: patch.updatedAt,
  })
}

function toWorkPatch(patch: Partial<StudioWork>) {
  return compactObject({
    session_id: patch.sessionId,
    run_id: patch.runId,
    type: patch.type,
    title: patch.title,
    status: patch.status,
    latest_task_id: patch.latestTaskId,
    current_result_id: patch.currentResultId,
    metadata: patch.metadata,
    created_at: patch.createdAt,
    updated_at: patch.updatedAt,
  })
}

function toWorkResultPatch(patch: Partial<StudioWorkResult>) {
  return compactObject({
    work_id: patch.workId,
    kind: patch.kind,
    summary: patch.summary,
    attachments: patch.attachments ? (patch.attachments as unknown as JsonRecord[]) : undefined,
    metadata: patch.metadata,
    created_at: patch.createdAt,
  })
}

function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
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

function asAttachments(value: JsonRecord[] | null): StudioWorkResult['attachments'] | undefined {
  return value ? (value as unknown as StudioWorkResult['attachments']) : undefined
}

