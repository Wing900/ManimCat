import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudioConversationWriter } from '../../domain/conversation-buffer'
import type {
  StudioAssistantMessage,
  StudioMessage,
  StudioMessagePart,
  StudioMessageStore,
  StudioPartStore,
  StudioUserMessage,
} from '../../domain/types'
import type { StudioMessageRow, StudioPartRow, JsonRecord } from './supabase-persistence-shared'
import { TABLES, compactObject, asOptional, asNullable, asTimeRange, readStudioSceneId } from './supabase-persistence-shared'

/** Two bounded bulk writes at the end of a Run; IDs make a failed flush retryable. */
export function createSupabaseStudioConversationWriter(client: SupabaseClient): StudioConversationWriter {
  return async messages => {
    if (!messages.length) return
    const rows = messages.map(message => message.role === 'user'
      ? toUserMessageRow(message) : toAssistantMessageRow(message))
    const { error } = await client.from(TABLES.messages).upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`[StudioDB] Failed to save conversation: ${error.message}`)
    const parts = messages.flatMap(message => message.role === 'assistant'
      ? message.parts.map((part, index) => ({
        ...toPartRow(part),
        // Bulk insertion must preserve the original part order, including text/tool interleaving.
        created_at: new Date(Date.parse(message.createdAt) + index).toISOString(),
      })) : [])
    if (!parts.length) return
    const saved = await client.from(TABLES.parts).upsert(parts, { onConflict: 'id' })
    if (saved.error) throw new Error(`[StudioDB] Failed to save conversation parts: ${saved.error.message}`)
  }
}

export function createSupabaseStudioMessageStore(client: SupabaseClient): StudioMessageStore {
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
    async listBySceneId(sceneId) {
      // Exact Scene matches only: `.eq` can never return a legacy row whose `scene_id` is NULL.
      const { data, error } = await client
        .from(TABLES.messages)
        .select('*')
        .eq('scene_id', sceneId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list scene messages: ${error.message}`)
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
export function createSupabaseStudioPartStore(client: SupabaseClient): StudioPartStore {
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
      sceneId: readStudioSceneId(row.scene_id, TABLES.messages, row.id),
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
    sceneId: readStudioSceneId(row.scene_id, TABLES.messages, row.id),
    role: 'user',
    text: row.text ?? '',
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
function toAssistantMessageRow(message: StudioAssistantMessage): StudioMessageRow {
  return {
    id: message.id,
    session_id: message.sessionId,
    scene_id: asNullable(message.sceneId),
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
    scene_id: asNullable(message.sceneId),
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
