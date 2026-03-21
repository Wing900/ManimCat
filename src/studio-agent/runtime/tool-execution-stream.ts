import type {
  StudioAssistantMessage,
  StudioPermissionRequest,
  StudioProcessorStreamEvent,
  StudioRun,
  StudioRuntimeTurnPlan,
  StudioSession,
  StudioSessionStore,
  StudioTaskStore,
  StudioWorkResultStore,
  StudioWorkStore
} from '../domain/types'
import type { StudioPermissionService } from '../permissions/permission-service'
import type { StudioToolRegistry } from '../tools/registry'
import { createStudioToolCallExecutionEvents } from './tool-call-adapter'
import type {
  StudioResolvedSkill,
  StudioRuntimeBackedToolContext,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from './tool-runtime-context'
import type { CustomApiConfig } from '../../types'

interface StudioTurnExecutionOptions {
  projectId: string
  session: StudioSession
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  plan: StudioRuntimeTurnPlan
  registry: StudioToolRegistry
  eventBus: StudioRuntimeBackedToolContext['eventBus']
  permissionService?: StudioPermissionService
  sessionStore?: StudioSessionStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  askForConfirmation?: (request: StudioPermissionRequest) => Promise<'once' | 'always' | 'reject'>
  runSubagent?: (input: StudioSubagentRunRequest) => Promise<StudioSubagentRunResult>
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  setToolMetadata: (callId: string, metadata: { title?: string; metadata?: Record<string, unknown> }) => void
  customApiConfig?: CustomApiConfig
}

export async function* createStudioTurnExecutionStream(
  input: StudioTurnExecutionOptions
): AsyncGenerator<StudioProcessorStreamEvent> {
  if (input.plan.assistantText) {
    yield { type: 'text-start' }
    yield { type: 'text-delta', text: input.plan.assistantText }
    yield { type: 'text-end' }
  }

  for (const toolCall of input.plan.toolCalls ?? []) {
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
      permissionService: input.permissionService,
      sessionStore: input.sessionStore,
      taskStore: input.taskStore,
      workStore: input.workStore,
      workResultStore: input.workResultStore,
      askForConfirmation: input.askForConfirmation,
      runSubagent: input.runSubagent,
      resolveSkill: input.resolveSkill,
      setToolMetadata: input.setToolMetadata,
      customApiConfig: input.customApiConfig
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
