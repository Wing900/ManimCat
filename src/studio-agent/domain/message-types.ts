import type { StudioAgentType } from './core-types'

export interface StudioMessageBase {
  id: string
  sessionId: string
  /**
   * Optional Scene scope of the message. Parts inherit this through their owning Message, so
   * `StudioMessagePart` deliberately carries no `sceneId`.
   */
  sceneId?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  createdAt: string
  updatedAt: string
}

export interface StudioPartTimeRange {
  start: number
  end?: number
}

export interface StudioTextPart {
  id: string
  messageId: string
  sessionId: string
  type: 'text'
  text: string
  time?: StudioPartTimeRange
}

export interface StudioReasoningPart {
  id: string
  messageId: string
  sessionId: string
  type: 'reasoning'
  text: string
  time?: StudioPartTimeRange
}

export interface StudioFileAttachment {
  kind: 'file'
  path: string
  name?: string
  mimeType?: string
}

export interface StudioToolStatePending {
  status: 'pending'
  input: Record<string, unknown>
  raw: string
}

export interface StudioToolStateRunning {
  status: 'running'
  input: Record<string, unknown>
  title?: string
  metadata?: Record<string, unknown>
  time: StudioPartTimeRange
}

export interface StudioToolStateCompleted {
  status: 'completed'
  input: Record<string, unknown>
  output: string
  title: string
  metadata?: Record<string, unknown>
  time: StudioPartTimeRange
  attachments?: StudioFileAttachment[]
}

export interface StudioToolStateError {
  status: 'error'
  input: Record<string, unknown>
  error: string
  metadata?: Record<string, unknown>
  time: StudioPartTimeRange
}

export type StudioToolState =
  | StudioToolStatePending
  | StudioToolStateRunning
  | StudioToolStateCompleted
  | StudioToolStateError

export interface StudioToolPart {
  id: string
  messageId: string
  sessionId: string
  type: 'tool'
  tool: string
  callId: string
  state: StudioToolState
  metadata?: Record<string, unknown>
}

export type StudioMessagePart = StudioTextPart | StudioReasoningPart | StudioToolPart

export interface StudioAssistantMessage extends StudioMessageBase {
  role: 'assistant'
  agent: StudioAgentType
  parts: StudioMessagePart[]
  summary?: string
  metadata?: Record<string, unknown>
}

export interface StudioUserMessage extends StudioMessageBase {
  role: 'user'
  text: string
}

export type StudioMessage = StudioAssistantMessage | StudioUserMessage
