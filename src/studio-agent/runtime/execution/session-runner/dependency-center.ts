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
  StudioSceneStore,
  StudioSession,
  StudioToolChoice,
  StudioRenderContext,
  StudioRenderStore,
} from '../../../domain/types'
import type { StudioRunExecutionScope } from '../../../domain/run-execution-scope'
import type { StudioToolRegistry } from '../../../tools/registry'
import type { StudioModelPort } from '../../../model/studio-model-port'

export interface StudioSessionRunnerOptions {
  registry: StudioToolRegistry
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore?: StudioRunStore
  renderStore?: StudioRenderStore
  /**
   * Scene records. Required for a Scene Run, where the execution scope is loaded from it; a
   * Legacy Run works without it.
   */
  sceneStore?: StudioSceneStore
  eventBus?: StudioEventBus
}

export interface StudioRunRequestInput {
  projectId: string
  session: StudioSession
  /** Scene scope of this Run; absent means the Legacy whole-Session Run. */
  sceneId?: string
  inputText: string
  customApiConfig?: CustomApiConfig
  modelPort?: StudioModelPort
  toolChoice?: StudioToolChoice
  runMetadata?: Record<string, unknown>
}

export interface StudioPreparedRunContext {
  input: StudioRunRequestInput
  /**
   * Immutable scope of this Run, assembled once before the model is invoked. Tools and prompt
   * facts read the write policy from here; nothing infers scope from metadata or model text.
   */
  executionScope: StudioRunExecutionScope
  renderContext: StudioRenderContext
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
  renderStore?: StudioRenderStore
  sceneStore?: StudioSceneStore
  sharedEventBus?: StudioEventBus
  createRun: (
    session: StudioSession,
    inputText: string,
    metadata?: Record<string, unknown>,
    sceneId?: string
  ) => StudioRun
  createAssistantMessage: (
    session: StudioSession,
    runId?: string,
    sceneId?: string,
    /** ISO of the Run's user message; forces this message strictly after it. */
    notBefore?: string
  ) => Promise<StudioAssistantMessage>
  buildRenderContext: (input: { session: StudioSession; sceneId?: string }) => Promise<StudioRenderContext>
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
    sceneStore: options.sceneStore,
    sharedEventBus: options.eventBus,
    createRun: input.createRun,
    createAssistantMessage: input.createAssistantMessage,
    buildRenderContext: input.buildRenderContext
  }
}
