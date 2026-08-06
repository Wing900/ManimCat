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
  StudioSessionEventStore,
  StudioSessionStore,
  StudioTaskStore,
  StudioToolChoice,
  StudioWorkContext,
  StudioWorkResultStore,
  StudioWorkStore,
  StudioRenderStore,
} from '../../../domain/types'
import type { StudioToolRegistry } from '../../../tools/registry'

export interface StudioSessionRunnerOptions {
  registry: StudioToolRegistry
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore?: StudioRunStore
  sessionStore?: StudioSessionStore
  sessionEventStore?: StudioSessionEventStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  renderStore?: StudioRenderStore
  eventBus?: StudioEventBus
}

export interface StudioRunRequestInput {
  projectId: string
  session: StudioSession
  inputText: string
  customApiConfig?: CustomApiConfig
  toolChoice?: StudioToolChoice
  runMetadata?: Record<string, unknown>
}

export interface StudioPreparedRunContext {
  input: StudioRunRequestInput
  workContext: StudioWorkContext
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  eventBus: StudioEventBus
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
  sessionStore?: StudioSessionStore
  sessionEventStore?: StudioSessionEventStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  renderStore?: StudioRenderStore
  sharedEventBus?: StudioEventBus
  createRun: (session: StudioSession, inputText: string, metadata?: Record<string, unknown>) => StudioRun
  createAssistantMessage: (session: StudioSession, runId?: string) => Promise<StudioAssistantMessage>
  buildWorkContext: (input: { session: StudioSession; inputText: string }) => Promise<StudioWorkContext>
}

export function createDependencyCenter(
  options: StudioSessionRunnerOptions,
  input: {
    processor: StudioRunProcessor
    createRun: StudioSessionRunnerDependencies['createRun']
    createAssistantMessage: StudioSessionRunnerDependencies['createAssistantMessage']
    buildWorkContext: StudioSessionRunnerDependencies['buildWorkContext']
  },
): StudioSessionRunnerDependencies {
  return {
    registry: options.registry,
    processor: input.processor,
    messageStore: options.messageStore,
    partStore: options.partStore,
    runStore: options.runStore,
    sessionStore: options.sessionStore,
    sessionEventStore: options.sessionEventStore,
    taskStore: options.taskStore,
    workStore: options.workStore,
    workResultStore: options.workResultStore,
    renderStore: options.renderStore,
    sharedEventBus: options.eventBus,
    createRun: input.createRun,
    createAssistantMessage: input.createAssistantMessage,
    buildWorkContext: input.buildWorkContext
  }
}
