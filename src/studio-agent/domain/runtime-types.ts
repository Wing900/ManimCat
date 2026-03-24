import type { StudioAssistantMessage, StudioFileAttachment } from './message-types'

export interface StudioPlannedToolCall {
  toolName: string
  callId: string
  input: unknown
}

export interface StudioRuntimeTurnPlan {
  assistantText?: string
  toolCalls?: StudioPlannedToolCall[]
}

export interface StudioWorkContextCurrentWork {
  id: string
  type: 'review' | 'design' | 'render' | 'edit' | 'video' | 'plot' | 'render-fix'
  status: 'pending' | 'running' | 'completed' | 'failed'
  title: string
}

export interface StudioWorkContextLastRender {
  status: 'success' | 'failed'
  timestamp: number
  workId?: string
  output?: {
    videoPath?: string
    imagePaths?: string[]
  }
  error?: string
}

export interface StudioWorkContextLastStaticCheck {
  timestamp: number
  issues: Array<{ file: string; line: number; severity: 'error' | 'warning' }>
}

export interface StudioWorkContextFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
}

export interface StudioWorkContextPendingEvent {
  id: string
  kind: 'render-status'
  title: string
  summary: string
  createdAt: string
}

export interface StudioWorkContext {
  sessionId: string
  agent: string
  currentWork?: StudioWorkContextCurrentWork
  lastRender?: StudioWorkContextLastRender
  lastStaticCheck?: StudioWorkContextLastStaticCheck
  fileChanges?: StudioWorkContextFileChange[]
  pendingEvents?: StudioWorkContextPendingEvent[]
}

export interface StudioStreamAssistantMessageStart {
  type: 'assistant-message-start'
  message: StudioAssistantMessage
}

export interface StudioStreamToolInputStart {
  type: 'tool-input-start'
  id: string
  toolName: string
  raw?: string
}

export interface StudioStreamToolCall {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export interface StudioStreamToolResult {
  type: 'tool-result'
  toolCallId: string
  output: string
  title?: string
  metadata?: Record<string, unknown>
  attachments?: StudioFileAttachment[]
}

export interface StudioStreamToolError {
  type: 'tool-error'
  toolCallId: string
  error: string
  metadata?: Record<string, unknown>
}

export interface StudioStreamTextStart {
  type: 'text-start'
}

export interface StudioStreamTextDelta {
  type: 'text-delta'
  text: string
}

export interface StudioStreamTextEnd {
  type: 'text-end'
}

export interface StudioStreamReasoningStart {
  type: 'reasoning-start'
}

export interface StudioStreamReasoningDelta {
  type: 'reasoning-delta'
  text: string
}

export interface StudioStreamReasoningEnd {
  type: 'reasoning-end'
}

export interface StudioStreamFinishStep {
  type: 'finish-step'
  usage?: {
    tokens?: number
  }
}

export type StudioProcessorStreamEvent =
  | StudioStreamAssistantMessageStart
  | StudioStreamToolInputStart
  | StudioStreamToolCall
  | StudioStreamToolResult
  | StudioStreamToolError
  | StudioStreamTextStart
  | StudioStreamTextDelta
  | StudioStreamTextEnd
  | StudioStreamReasoningStart
  | StudioStreamReasoningDelta
  | StudioStreamReasoningEnd
  | StudioStreamFinishStep
