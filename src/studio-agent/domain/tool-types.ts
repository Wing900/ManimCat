import type { StudioAgentType, StudioKind, StudioRun, StudioSession } from './core-types'
import type { StudioAssistantMessage, StudioFileAttachment } from './message-types'
import type { StudioEventBus } from './event-types'
import type {
  StudioSessionStore,
  StudioRenderStore,
} from './store-types'
import type { StudioToolParameters } from '../tools/tool-parameters'

export interface StudioToolResult {
  title: string
  output: string
  metadata?: Record<string, unknown>
  attachments?: StudioFileAttachment[]
}

export interface StudioToolFailure {
  error: string
  metadata?: Record<string, unknown>
}

export interface StudioToolContext {
  projectId: string
  session: StudioSession
  run: StudioRun
  abortSignal?: AbortSignal
  assistantMessage: StudioAssistantMessage
  eventBus: StudioEventBus
  renderStore?: StudioRenderStore
  setToolMetadata?: (metadata: { title?: string; metadata?: Record<string, unknown> }) => void
}

export interface StudioToolDefinition<TInput = unknown> {
  name: string
  parameters: StudioToolParameters
  description: string
  allowedAgents: StudioAgentType[]
  allowedStudioKinds?: StudioKind[]
  execute: (input: TInput, context: StudioToolContext) => Promise<StudioToolResult>
}
