import type {
  StudioAssistantMessage,
  StudioProcessorStreamEvent,
  StudioRun,
  StudioRuntimeTurnPlan,
  StudioSession,
  StudioSessionStore,
  StudioTaskStore,
  StudioWorkResultStore,
  StudioWorkStore
} from '../../domain/types'
import type { StudioToolRegistry } from '../../tools/registry'
import { createStudioToolCallExecutionEvents } from '../tools/tool-call-adapter'
import type {
  StudioResolvedSkill,
  StudioRuntimeBackedToolContext,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from '../tools/tool-runtime-context'
import type { CustomApiConfig } from '../../../types'
import { throwIfStudioRunCancelled } from './run-cancellation'

interface StudioTurnExecutionOptions {
  projectId: string
  session: StudioSession
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  plan: StudioRuntimeTurnPlan
  registry: StudioToolRegistry
  eventBus: StudioRuntimeBackedToolContext['eventBus']
  messageStore?: StudioRuntimeBackedToolContext['messageStore']
  partStore?: StudioRuntimeBackedToolContext['partStore']
  sessionStore?: StudioSessionStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  runSubagent?: (input: StudioSubagentRunRequest) => Promise<StudioSubagentRunResult>
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  listSkills?: (session: StudioSession) => Promise<StudioSkillDiscoveryEntry[]>
  listSkillSummaries?: (session: StudioSession) => Promise<StudioSkillUsageSummary[]>
  recordSkillUsage?: StudioRuntimeBackedToolContext['recordSkillUsage']
  setToolMetadata: (callId: string, metadata: { title?: string; metadata?: Record<string, unknown> }) => void
  customApiConfig?: CustomApiConfig
  abortSignal?: AbortSignal
}

export async function* createStudioTurnExecutionStream(
  input: StudioTurnExecutionOptions
): AsyncGenerator<StudioProcessorStreamEvent> {
  const hasAssistantText = Boolean(input.plan.assistantText?.trim())

  if (hasAssistantText) {
    yield { type: 'text-start' }
    yield { type: 'text-delta', text: input.plan.assistantText ?? '' }
    yield { type: 'text-end' }
  }

  for (const toolCall of input.plan.toolCalls ?? []) {
    throwIfStudioRunCancelled(input.abortSignal)
    const toolInput = asToolInput(toolCall.input)
    yield* createStudioToolCallExecutionEvents({
      projectId: input.projectId,
      session: input.session,
      run: input.run,
      assistantMessage: input.assistantMessage,
      toolCallId: toolCall.callId,
      toolName: toolCall.toolName,
      toolInput,
      registry: input.registry,
      eventBus: input.eventBus,
      messageStore: input.messageStore,
      partStore: input.partStore,
      sessionStore: input.sessionStore,
      taskStore: input.taskStore,
      workStore: input.workStore,
      workResultStore: input.workResultStore,
      runSubagent: input.runSubagent,
      resolveSkill: input.resolveSkill,
      listSkills: input.listSkills,
      listSkillSummaries: input.listSkillSummaries,
      recordSkillUsage: input.recordSkillUsage,
      setToolMetadata: input.setToolMetadata,
      customApiConfig: input.customApiConfig,
      abortSignal: input.abortSignal,
      commentary: hasAssistantText ? null : undefined
    })
  }

  yield { type: 'finish-step' }
}

function asToolInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  return {}
}



