import type {
  StudioFileAttachment,
  StudioRun,
  StudioRender,
} from './studio-agent-types'

export interface StudioRunUpdatedExternalEvent {
  type: 'run.updated'
  properties: {
    sessionId: string
    run: StudioRun
  }
}

export interface StudioRenderUpdatedExternalEvent {
  type: 'render.updated'
  properties: {
    sessionId: string
    runId?: string
    render: StudioRender
  }
}

export interface StudioAssistantTextExternalEvent {
  type: 'assistant.text'
  properties: {
    sessionId: string
    runId: string
    messageId: string
    text: string
  }
}

export interface StudioToolInputStartExternalEvent {
  type: 'tool.input-start'
  properties: {
    sessionId: string
    runId: string
    messageId: string
    toolName: string
    callId: string
    raw: string
  }
}

export interface StudioToolCallExternalEvent {
  type: 'tool.call'
  properties: {
    sessionId: string
    runId: string
    messageId: string
    toolName: string
    callId: string
    input: Record<string, unknown>
  }
}

export interface StudioToolResultExternalEvent {
  type: 'tool.result'
  properties: {
    sessionId: string
    runId: string
    messageId: string
    toolName: string
    callId: string
    status: 'completed' | 'failed'
    title?: string
    output?: string
    metadata?: Record<string, unknown>
    attachments?: StudioFileAttachment[]
    error?: string
  }
}

export interface StudioConnectedExternalEvent {
  type: 'studio.connected'
  properties: {
    timestamp: number
  }
}

export interface StudioHeartbeatExternalEvent {
  type: 'studio.heartbeat'
  properties: {
    timestamp: number
  }
}

export type StudioExternalEvent =
  | StudioRunUpdatedExternalEvent
  | StudioRenderUpdatedExternalEvent
  | StudioAssistantTextExternalEvent
  | StudioToolInputStartExternalEvent
  | StudioToolCallExternalEvent
  | StudioToolResultExternalEvent
  | StudioConnectedExternalEvent
  | StudioHeartbeatExternalEvent

