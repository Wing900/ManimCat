import type OpenAI from 'openai'
import type {
  StudioAssistantMessage,
  StudioMessageStore,
  StudioRun,
  StudioSession,
  StudioSessionStore,
  StudioTaskStore,
  StudioToolChoice,
  StudioWorkContext,
  StudioWorkResultStore,
  StudioWorkStore
} from '../../domain/types'
import type { StudioToolRegistry } from '../../tools/registry'
import type {
  StudioResolvedSkill,
  StudioRuntimeBackedToolContext,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from '../../runtime/tools/tool-runtime-context'
import type { CustomApiConfig } from '../../../types'
import type { buildStudioChatTools } from '../studio-tool-schema'
import type { buildStudioConversationMessages } from '../studio-message-history'
import type { requestStudioChatCompletion } from '../studio-provider-request'
import type { readStudioRunAutonomyMetadata } from '../../runs/autonomy-policy'

export type StudioLoopAutonomy = ReturnType<typeof readStudioRunAutonomyMetadata>
export type StudioChatCompletion = Awaited<ReturnType<typeof requestStudioChatCompletion>>
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
  sessionStore?: StudioSessionStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  workContext?: StudioWorkContext
  runSubagent?: (input: StudioSubagentRunRequest) => Promise<StudioSubagentRunResult>
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  listSkills?: (session: StudioSession) => Promise<StudioSkillDiscoveryEntry[]>
  listSkillSummaries?: (session: StudioSession) => Promise<StudioSkillUsageSummary[]>
  recordSkillUsage?: StudioRuntimeBackedToolContext['recordSkillUsage']
  createAssistantMessage: () => Promise<StudioAssistantMessage>
  setToolMetadata: (assistantMessage: StudioAssistantMessage, callId: string, metadata: { title?: string; metadata?: Record<string, unknown> }) => void
  customApiConfig: CustomApiConfig
  maxSteps?: number
  toolChoice?: StudioToolChoice
  onCheckpoint?: (patch: Partial<StudioRun>) => Promise<void>
  abortSignal?: AbortSignal
}

export interface StudioLoopRuntime {
  client: OpenAI
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
