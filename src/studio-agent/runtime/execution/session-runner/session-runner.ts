import { StudioRunProcessor } from '../run-processor'
import type {
  StudioAssistantMessage,
  StudioRun,
  StudioSession,
  StudioRuntimeTurnPlan,
  StudioToolChoice,
} from '../../../domain/types'
import type { CustomApiConfig } from '../../../../types'
import type { StudioSubagentRunRequest, StudioSubagentRunResult } from '../../tools/tool-runtime-context'
import type {
  StudioBackgroundRunHandle,
  StudioPreparedRunContext,
  StudioRunRequestInput,
  StudioSessionRunnerDependencies,
  StudioSessionRunnerOptions
} from './dependency-center'
import { createAssistantMessage, createRun } from './factory'
import { buildWorkContext, prepareRun } from './preparer'
import { routePreparedRun } from './router'
import { createResolvedPlanExecution } from './execution-factories'
import { executePreparedStream } from './execution-manager'
import { createDependencyCenter } from './dependency-center'
import { runSubagent as executeSubagent } from './subagent-manager'

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
      buildWorkContext: (input) => buildWorkContext({
        workStore: options.workStore,
        workResultStore: options.workResultStore,
        taskStore: options.taskStore,
        sessionEventStore: options.sessionEventStore
      }, input),
      runSubagent: (input) => this.runSubagent(input)
    })
  }

  async createAssistantMessage(session: StudioSession): Promise<StudioAssistantMessage> {
    return createAssistantMessage(this.deps, session)
  }

  createRun(session: StudioSession, inputText: string, metadata?: Record<string, unknown>): StudioRun {
    return createRun(session, inputText, metadata)
  }

  async run(input: StudioRunRequestInput): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
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

  async runWithPlan(input: {
    projectId: string
    session: StudioSession
    inputText: string
    plan: StudioRuntimeTurnPlan
    customApiConfig?: CustomApiConfig
    toolChoice?: StudioToolChoice
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const prepared = await prepareRun(this.deps, input)
    const abortController = new AbortController()
    return executePreparedStream(this.deps, prepared, createResolvedPlanExecution(this.deps, {
      prepared,
      plan: input.plan,
      customApiConfig: input.customApiConfig,
      toolChoice: input.toolChoice,
      abortSignal: abortController.signal,
    }), abortController.signal)
  }

  async runSubagent(input: StudioSubagentRunRequest): Promise<StudioSubagentRunResult> {
    return executeSubagent(this.deps, input, (request) => this.run(request))
  }

  private async executePreparedRun(prepared: StudioPreparedRunContext, abortSignal: AbortSignal) {
    return routePreparedRun(this.deps, prepared, abortSignal)
  }
}
