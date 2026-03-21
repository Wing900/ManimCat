import type {
  StudioPermissionDecision,
  StudioPermissionRequest,
  StudioRun,
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
    run: StudioRun
  }
}

export interface StudioAssistantTextExternalEvent {
  type: 'assistant.text'
  properties: {
    sessionId: string
    runId: string
    text: string
  }
}

export interface StudioPermissionAskedExternalEvent {
  type: 'permission.asked'
  properties: StudioPermissionRequest
}

export interface StudioPermissionRepliedExternalEvent {
  type: 'permission.replied'
  properties: {
    sessionID: string
    requestID: string
    reply: StudioPermissionDecision
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
  | StudioAssistantTextExternalEvent
  | StudioPermissionAskedExternalEvent
  | StudioPermissionRepliedExternalEvent
  | StudioQuestionRequestedExternalEvent
  | StudioConnectedExternalEvent
  | StudioHeartbeatExternalEvent
