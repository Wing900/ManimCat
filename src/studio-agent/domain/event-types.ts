import type { StudioRender, StudioRun, StudioSession } from './core-types'
import type { StudioFileAttachment } from './message-types'

export interface StudioAssistantTextEvent {
  type: 'assistant_text'
  sessionId: string
  runId: string
  messageId: string
  text: string
}

export interface StudioToolInputStartEvent {
  type: 'tool_input_start'
  sessionId: string
  runId: string
  messageId: string
  toolName: string
  callId: string
  raw?: string
}

export interface StudioToolCallEvent {
  type: 'tool_call'
  sessionId: string
  runId: string
  messageId: string
  toolName: string
  callId: string
  input: unknown
}

export interface StudioToolResultEvent {
  type: 'tool_result'
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

export interface StudioRunEvent {
  type: 'run_updated'
  sessionId: string
  run: StudioRun
}

export interface StudioRenderEvent {
  type: 'render_updated'
  sessionId: string
  runId?: string
  render: StudioRender
}

export type StudioAgentEvent =
  | StudioAssistantTextEvent
  | StudioToolInputStartEvent
  | StudioToolCallEvent
  | StudioToolResultEvent
  | StudioRunEvent
  | StudioRenderEvent

export interface StudioEventBus {
  publish: (event: StudioAgentEvent) => void
  subscribe: (sessionId: string, listener: (event: StudioAgentEvent) => void) => () => void
}
