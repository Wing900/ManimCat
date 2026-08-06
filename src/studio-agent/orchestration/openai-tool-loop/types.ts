import type {
  StudioAssistantMessage,
  StudioMessageStore,
  StudioRun,
  StudioSession,
  StudioToolChoice,
  StudioRenderContext,
  StudioRenderStore,
} from '../../domain/types'
import type { StudioToolRegistry } from '../../tools/registry'
import type {
  StudioRuntimeBackedToolContext
} from '../../runtime/tools/tool-runtime-context'
import type { CustomApiConfig } from '../../../types'
import type { buildStudioChatTools } from '../studio-tool-schema'
import type { buildStudioConversationMessages } from '../studio-message-history'
import type { readStudioRunAutonomyMetadata } from '../../runs/autonomy-policy'
import type { StudioModelPort, StudioModelResponse } from '../../model/studio-model-port'

export type StudioLoopAutonomy = ReturnType<typeof readStudioRunAutonomyMetadata>
export type StudioChatCompletion = StudioModelResponse
export type StudioChatCompletionMessage = NonNullable<StudioChatCompletion['choices'][number]['message']>
export type StudioChatToolCall = NonNullable<StudioChatCompletionMessage['tool_calls']>[number]

export interface StudioOpenAIToolLoopInput {
  projectId: string
  session: StudioSession
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  inputText: string
  messageStore: StudioMessageStore
  registry: StudioToolRegistry
  eventBus: StudioRuntimeBackedToolContext['eventBus']
  renderStore?: StudioRenderStore
  renderContext?: StudioRenderContext
  documentationContext?: string
  createAssistantMessage: () => Promise<StudioAssistantMessage>
  setToolMetadata: (assistantMessage: StudioAssistantMessage, callId: string, metadata: { title?: string; metadata?: Record<string, unknown> }) => void
  customApiConfig?: CustomApiConfig
  modelPort?: StudioModelPort
  maxSteps?: number
  toolChoice?: StudioToolChoice
  onCheckpoint?: (patch: Partial<StudioRun>) => Promise<void>
  abortSignal?: AbortSignal
}

export interface StudioLoopRuntime {
  modelPort: StudioModelPort
  model: string
  tools: ReturnType<typeof buildStudioChatTools>
  conversation: ReturnType<typeof buildStudioConversationMessages>
  systemPrompt: string
  maxSteps: number
  toolChoice: StudioToolChoice
  currentAssistantMessage: StudioAssistantMessage
}

export interface StudioLoopStepRequest {
  messages: Array<{ role: 'system'; content: string } | ReturnType<typeof buildStudioConversationMessages>[number]>
  requestMessageCharsApprox: number
  requestToolSchemaCharsApprox: number
}

export interface StudioLoopStepResult {
  completion: StudioChatCompletion
  message: StudioChatCompletionMessage | undefined
  assistantText: string
  toolCalls: StudioChatToolCall[]
}
