import { StudioRunProcessor } from '../run-processor'
import type {
  StudioAssistantMessage,
  StudioRun,
  StudioSession,
} from '../../../domain/types'
import type { StudioRunExecutionResult } from '../../tools/tool-runtime-context'
import type {
  StudioBackgroundRunHandle,
  StudioPreparedRunContext,
  StudioRunRequestInput,
  StudioSessionRunnerDependencies,
  StudioSessionRunnerOptions
} from './dependency-center'
import { createAssistantMessage, createRun } from './factory'
import { buildRenderContext, prepareRun } from './preparer'
import { routePreparedRun } from './router'
import { executePreparedStream } from './execution-manager'
import { createDependencyCenter } from './dependency-center'

export class StudioSessionRunner {
  private readonly deps: StudioSessionRunnerDependencies

  constructor(options: StudioSessionRunnerOptions) {
    const processor = new StudioRunProcessor({
      messageStore: options.messageStore,
      partStore: options.partStore
    })
    this.deps = createDependencyCenter(options, {
      processor,
      createRun: (session, inputText, metadata) => createRun(session, inputText, metadata),
      createAssistantMessage: (session) => createAssistantMessage({ messageStore: options.messageStore }, session),
      buildRenderContext: (input) => buildRenderContext({
        renderStore: options.renderStore
      }, input)
    })
  }

  async createAssistantMessage(session: StudioSession): Promise<StudioAssistantMessage> {
    return createAssistantMessage(this.deps, session)
  }

  createRun(session: StudioSession, inputText: string, metadata?: Record<string, unknown>): StudioRun {
    return createRun(session, inputText, metadata)
  }

  async run(input: StudioRunRequestInput): Promise<StudioRunExecutionResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const handle = await this.startBackgroundRun(input)
    return handle.completion
  }

  async startBackgroundRun(input: StudioRunRequestInput): Promise<StudioBackgroundRunHandle> {
    const prepared = await prepareRun(this.deps, input)
    const abortController = new AbortController()
    return {
      run: prepared.run,
      assistantMessage: prepared.assistantMessage,
      abort: (reason?: string) => abortController.abort(reason ?? 'Run cancelled'),
      completion: this.executePreparedRun(prepared, abortController.signal)
    }
  }

  private async executePreparedRun(prepared: StudioPreparedRunContext, abortSignal: AbortSignal) {
    return routePreparedRun(this.deps, prepared, abortSignal)
  }
}
