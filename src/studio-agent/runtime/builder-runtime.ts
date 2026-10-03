import type { CustomApiConfig } from '../../types'
import type {
  StudioAssistantMessage,
  StudioEventBus,
  StudioMessageStore,
  StudioPartStore,
  StudioRun,
  StudioRunStore,
  StudioSceneStore,
  StudioSession,
  StudioToolChoice,
  StudioRenderStore,
} from '../domain/types'
import { StudioToolRegistry } from '../tools/registry'
import type { StudioModelPort } from '../model/studio-model-port'
import { StudioSessionRunner } from './execution/session-runner/session-runner'
import type { StudioBackgroundRunHandle } from './execution/session-runner/dependency-center'
import type { StudioRunExecutionResult } from './tools/tool-runtime-context'

interface StudioBuilderRuntimeOptions {
  registry: StudioToolRegistry
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore?: StudioRunStore
  renderStore?: StudioRenderStore
  sceneStore?: StudioSceneStore
  eventBus?: StudioEventBus
}

export class StudioBuilderRuntime {
  private readonly runner: StudioSessionRunner

  constructor(options: StudioBuilderRuntimeOptions) {
    this.runner = new StudioSessionRunner({
      registry: options.registry,
      messageStore: options.messageStore,
      partStore: options.partStore,
      runStore: options.runStore,
      renderStore: options.renderStore,
      sceneStore: options.sceneStore,
      eventBus: options.eventBus,
    })
  }

  async createAssistantMessage(session: StudioSession): Promise<StudioAssistantMessage> {
    return this.runner.createAssistantMessage(session)
  }

  createRun(session: StudioSession, inputText: string, metadata?: Record<string, unknown>): StudioRun {
    return this.runner.createRun(session, inputText, metadata)
  }

  async run(input: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: CustomApiConfig
    modelPort?: StudioModelPort
    toolChoice?: StudioToolChoice
    runMetadata?: Record<string, unknown>
  }): Promise<StudioRunExecutionResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    return this.runner.run(input)
  }

  async startBackgroundRun(input: {
    projectId: string
    session: StudioSession
    /** Scene scope of this Run; absent means the Legacy whole-Session Run. */
    sceneId?: string
    inputText: string
    customApiConfig?: CustomApiConfig
    modelPort?: StudioModelPort
    toolChoice?: StudioToolChoice
    runMetadata?: Record<string, unknown>
  }): Promise<StudioBackgroundRunHandle> {
    return this.runner.startBackgroundRun(input)
  }

  abortBackgroundRun(handle: StudioBackgroundRunHandle, reason?: string): void {
    handle.abort(reason)
  }
}
