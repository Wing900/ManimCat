import type { StudioAssistantMessage, StudioFileAttachment } from './message-types'

export interface StudioRenderContextLatestRender {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  timestamp: number
  output?: {
    videoPath?: string
    imagePaths?: string[]
  }
  error?: string
}

export interface StudioRenderContext {
  sessionId: string
  agent: string
  latestRender?: StudioRenderContextLatestRender
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
