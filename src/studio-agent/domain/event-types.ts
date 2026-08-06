import type { StudioRender, StudioRun, StudioSession, StudioSessionEvent, StudioTask, StudioWork, StudioWorkResult } from './core-types'
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

export interface StudioTaskEvent {
  type: 'task_updated'
  sessionId: string
  runId?: string
  task: StudioTask
}

export interface StudioWorkEvent {
  type: 'work_updated'
  sessionId: string
  runId?: string
  work: StudioWork
}

export interface StudioWorkResultEvent {
  type: 'work_result_updated'
  sessionId: string
  runId?: string
  result: StudioWorkResult
}

export interface StudioSessionEventQueuedEvent {
  type: 'session_event_queued'
  sessionId: string
  runId?: string
  event: StudioSessionEvent
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
  | StudioTaskEvent
  | StudioWorkEvent
  | StudioWorkResultEvent
  | StudioSessionEventQueuedEvent
  | StudioRunEvent
  | StudioRenderEvent

export interface StudioEventBus {
  publish: (event: StudioAgentEvent) => void
  subscribe: (sessionId: string, listener: (event: StudioAgentEvent) => void) => () => void
}
