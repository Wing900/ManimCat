import type { CustomApiConfig } from '../../../../types'
import type { StudioRunProcessor } from '../run-processor'
import type { StudioRunExecutionResult } from '../../tools/tool-runtime-context'
import type {
  StudioAssistantMessage,
  StudioEventBus,
  StudioMessageStore,
  StudioPartStore,
  StudioProcessorStreamEvent,
  StudioRun,
  StudioRunStore,
  StudioSession,
  StudioToolChoice,
  StudioRenderContext,
  StudioRenderStore,
} from '../../../domain/types'
import type { StudioDocumentationContextProvider } from '../../../documentation/studio-documentation-context'
import type { StudioToolRegistry } from '../../../tools/registry'
import type { StudioModelPort } from '../../../model/studio-model-port'

export interface StudioSessionRunnerOptions {
  registry: StudioToolRegistry
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore?: StudioRunStore
  renderStore?: StudioRenderStore
  documentationProvider?: StudioDocumentationContextProvider
  eventBus?: StudioEventBus
}

export interface StudioRunRequestInput {
  projectId: string
  session: StudioSession
  inputText: string
  customApiConfig?: CustomApiConfig
  modelPort?: StudioModelPort
  toolChoice?: StudioToolChoice
  runMetadata?: Record<string, unknown>
}

export interface StudioPreparedRunContext {
  input: StudioRunRequestInput
  renderContext: StudioRenderContext
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  eventBus: StudioEventBus
  documentationContext: string
}

export interface StudioPreparedRunExecution {
  events: AsyncGenerator<StudioProcessorStreamEvent>
  startLog?: {
    event: string
    payload: Record<string, unknown>
  }
}

export interface StudioBackgroundRunHandle {
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  abort: (reason?: string) => void
  completion: Promise<StudioRunExecutionResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }>
}

export interface StudioSessionRunnerDependencies {
  registry: StudioToolRegistry
  processor: StudioRunProcessor
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore?: StudioRunStore
  renderStore?: StudioRenderStore
  documentationProvider?: StudioDocumentationContextProvider
  sharedEventBus?: StudioEventBus
  createRun: (session: StudioSession, inputText: string, metadata?: Record<string, unknown>) => StudioRun
  createAssistantMessage: (session: StudioSession, runId?: string) => Promise<StudioAssistantMessage>
  buildRenderContext: (input: { session: StudioSession }) => Promise<StudioRenderContext>
}

export function createDependencyCenter(
  options: StudioSessionRunnerOptions,
  input: {
    processor: StudioRunProcessor
    createRun: StudioSessionRunnerDependencies['createRun']
    createAssistantMessage: StudioSessionRunnerDependencies['createAssistantMessage']
    buildRenderContext: StudioSessionRunnerDependencies['buildRenderContext']
  },
): StudioSessionRunnerDependencies {
  return {
    registry: options.registry,
    processor: input.processor,
    messageStore: options.messageStore,
    partStore: options.partStore,
    runStore: options.runStore,
    renderStore: options.renderStore,
    documentationProvider: options.documentationProvider,
    sharedEventBus: options.eventBus,
    createRun: input.createRun,
    createAssistantMessage: input.createAssistantMessage,
    buildRenderContext: input.buildRenderContext
  }
}
