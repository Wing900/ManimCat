import { randomUUID } from 'node:crypto'
import type {
  StudioAgentType,
  StudioAssistantMessage,
  StudioFileAttachment,
  StudioMessagePart,
  StudioPermissionLevel,
  StudioPermissionRule,
  StudioReasoningPart,
  StudioRun,
  StudioSession,
  StudioTask,
  StudioTaskStatus,
  StudioTaskType,
  StudioTextPart,
  StudioToolPart,
  StudioUserMessage,
  StudioWork,
  StudioWorkResult,
  StudioWorkResultKind,
  StudioWorkStatus,
  StudioWorkType
} from './types'

function nowIso(): string {
  return new Date().toISOString()
}

export function createStudioSession(input: {
  projectId: string
  workspaceId?: string
  parentSessionId?: string
  agentType: StudioAgentType
  title: string
  directory: string
  permissionLevel: StudioPermissionLevel
  permissionRules?: StudioPermissionRule[]
}): StudioSession {
  const timestamp = nowIso()
  return {
    id: `sess_${randomUUID()}`,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    parentSessionId: input.parentSessionId,
    agentType: input.agentType,
    title: input.title,
    directory: input.directory,
    permissionLevel: input.permissionLevel,
    permissionRules: input.permissionRules ?? [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function createStudioRun(input: {
  sessionId: string
  inputText: string
  activeAgent: StudioAgentType
}): StudioRun {
  return {
    id: `run_${randomUUID()}`,
    sessionId: input.sessionId,
    status: 'pending',
    inputText: input.inputText,
    activeAgent: input.activeAgent,
    createdAt: nowIso()
  }
}

export function createStudioTask(input: {
  sessionId: string
  runId?: string
  workId?: string
  type: StudioTaskType
  status?: StudioTaskStatus
  title: string
  detail?: string
  metadata?: Record<string, unknown>
}): StudioTask {
  const timestamp = nowIso()
  return {
    id: `task_${randomUUID()}`,
    sessionId: input.sessionId,
    runId: input.runId,
    workId: input.workId,
    type: input.type,
    status: input.status ?? 'proposed',
    title: input.title,
    detail: input.detail,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: input.metadata
  }
}

export function createStudioWork(input: {
  sessionId: string
  runId?: string
  type: StudioWorkType
  title: string
  status?: StudioWorkStatus
  latestTaskId?: string
  currentResultId?: string
  metadata?: Record<string, unknown>
}): StudioWork {
  const timestamp = nowIso()
  return {
    id: `work_${randomUUID()}`,
    sessionId: input.sessionId,
    runId: input.runId,
    type: input.type,
    title: input.title,
    status: input.status ?? 'proposed',
    latestTaskId: input.latestTaskId,
    currentResultId: input.currentResultId,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: input.metadata
  }
}

export function createStudioWorkResult(input: {
  workId: string
  kind: StudioWorkResultKind
  summary: string
  attachments?: StudioFileAttachment[]
  metadata?: Record<string, unknown>
}): StudioWorkResult {
  return {
    id: `work_result_${randomUUID()}`,
    workId: input.workId,
    kind: input.kind,
    summary: input.summary,
    attachments: input.attachments,
    metadata: input.metadata,
    createdAt: nowIso()
  }
}

export function createStudioAssistantMessage(input: {
  sessionId: string
  agent: StudioAgentType
}): StudioAssistantMessage {
  const timestamp = nowIso()
  return {
    id: `msg_${randomUUID()}`,
    sessionId: input.sessionId,
    role: 'assistant',
    agent: input.agent,
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function createStudioUserMessage(input: {
  sessionId: string
  text: string
}): StudioUserMessage {
  const timestamp = nowIso()
  return {
    id: `msg_${randomUUID()}`,
    sessionId: input.sessionId,
    role: 'user',
    text: input.text,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function createStudioTextPart(input: {
  messageId: string
  sessionId: string
  type?: 'text' | 'reasoning'
  text?: string
}): StudioTextPart | StudioReasoningPart {
  const base = {
    id: `part_${randomUUID()}`,
    messageId: input.messageId,
    sessionId: input.sessionId,
    text: input.text ?? '',
    time: { start: Date.now() }
  }

  if (input.type === 'reasoning') {
    return {
      ...base,
      type: 'reasoning'
    }
  }

  return {
    ...base,
    type: 'text'
  }
}

export function createStudioToolPart(input: {
  messageId: string
  sessionId: string
  tool: string
  callId: string
  raw?: string
}): StudioToolPart {
  return {
    id: `part_${randomUUID()}`,
    messageId: input.messageId,
    sessionId: input.sessionId,
    type: 'tool',
    tool: input.tool,
    callId: input.callId,
    state: {
      status: 'pending',
      input: {},
      raw: input.raw ?? ''
    }
  }
}

export function replaceMessagePart(parts: StudioMessagePart[], nextPart: StudioMessagePart): StudioMessagePart[] {
  const index = parts.findIndex((part) => part.id === nextPart.id)
  if (index < 0) {
    return [...parts, nextPart]
  }

  const next = [...parts]
  next[index] = nextPart
  return next
}
