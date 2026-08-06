import type {
  StudioFileAttachment,
  StudioRun,
  StudioRender,
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from './studio-agent-types'

export interface StudioTaskUpdatedExternalEvent {
  type: 'task.updated'
  properties: {
    sessionId: string
    runId?: string
    task: StudioTask
  }
}

export interface StudioWorkUpdatedExternalEvent {
  type: 'work.updated'
  properties: {
    sessionId: string
    runId?: string
    work: StudioWork
  }
}

export interface StudioWorkResultUpdatedExternalEvent {
  type: 'work-result.updated'
  properties: {
    sessionId: string
    runId?: string
    result: StudioWorkResult
  }
}

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

export interface StudioQuestionRequestedExternalEvent {
  type: 'question.requested'
  properties: {
    sessionId: string
    runId: string
    question: string
    details?: string
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
  | StudioTaskUpdatedExternalEvent
  | StudioWorkUpdatedExternalEvent
  | StudioWorkResultUpdatedExternalEvent
  | StudioRunUpdatedExternalEvent
  | StudioRenderUpdatedExternalEvent
  | StudioAssistantTextExternalEvent
  | StudioToolInputStartExternalEvent
  | StudioToolCallExternalEvent
  | StudioToolResultExternalEvent
  | StudioQuestionRequestedExternalEvent
  | StudioConnectedExternalEvent
  | StudioHeartbeatExternalEvent

