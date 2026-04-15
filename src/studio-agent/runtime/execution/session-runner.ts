import type { CustomApiConfig } from '../../../types'
import { InMemoryStudioEventBus } from '../../events/event-bus'
import { createStudioUserMessage } from '../../domain/factories'
import { createStudioOpenAIToolLoop } from '../../orchestration/studio-openai-tool-loop'
import { createStudioTurnExecutionStream } from './tool-execution-stream'
import { StudioRunProcessor } from './run-processor'
import type { StudioTurnPlanResolver } from '../planning/turn-plan-resolver'
import type {
  StudioResolvedSkill,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from '../tools/tool-runtime-context'
import {
  buildDraftAssistantMessage,
  buildDraftRun,
  buildSubagentPrompt,
  cancelRunState,
  extractLatestAssistantText,
  failRunState,
  finalizeRunState
} from './session-runner-helpers'
import { buildStudioWorkContext } from './work-context'
import { resolveStudioToolChoice } from '../session/session-agent-config'
import type {
  StudioAssistantMessage,
  StudioEventBus,
  StudioMessageStore,
  StudioPartStore,
  StudioProcessorStreamEvent,
  StudioRun,
  StudioRunStore,
  StudioRuntimeTurnPlan,
  StudioSession,
  StudioSessionEventStore,
  StudioSessionStore,
  StudioTaskStore,
  StudioToolChoice,
  StudioWorkContext,
  StudioWorkResultStore,
  StudioWorkStore
} from '../../domain/types'
import { StudioToolRegistry } from '../../tools/registry'
import { logPlotStudioTiming, readElapsedMs, readRunElapsedMs } from '../../observability/plot-studio-timing'
import { isStudioRunCancelledError, throwIfStudioRunCancelled } from './run-cancellation'

interface StudioSessionRunnerOptions {
  registry: StudioToolRegistry
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore?: StudioRunStore
  sessionStore?: StudioSessionStore
  sessionEventStore?: StudioSessionEventStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  eventBus?: StudioEventBus
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  listSkills?: (session: StudioSession) => Promise<StudioSkillDiscoveryEntry[]>
  listSkillSummaries?: (session: StudioSession) => Promise<StudioSkillUsageSummary[]>
  recordSkillUsage?: (input: {
    session: StudioSession
    skillName: string
    reason?: string
    takeaway?: string
    stillRelevant?: boolean
  }) => Promise<void>
  resolveTurnPlan: StudioTurnPlanResolver
}

interface StudioRunRequestInput {
  projectId: string
  session: StudioSession
  inputText: string
  customApiConfig?: CustomApiConfig
  toolChoice?: StudioToolChoice
  runMetadata?: Record<string, unknown>
}

interface StudioPreparedRunContext {
  input: StudioRunRequestInput
  workContext: StudioWorkContext
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  eventBus: StudioEventBus
}

interface StudioPreparedRunExecution {
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
  completion: Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }>
}

export class StudioSessionRunner {
  private readonly registry: StudioToolRegistry
  private readonly processor: StudioRunProcessor
  private readonly messageStore: StudioMessageStore
  private readonly runStore?: StudioRunStore
  private readonly sessionStore?: StudioSessionStore
  private readonly sessionEventStore?: StudioSessionEventStore
  private readonly taskStore?: StudioTaskStore
  private readonly workStore?: StudioWorkStore
  private readonly workResultStore?: StudioWorkResultStore
  private readonly sharedEventBus?: StudioEventBus
  private readonly resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  private readonly listSkills?: (session: StudioSession) => Promise<StudioSkillDiscoveryEntry[]>
  private readonly listSkillSummaries?: (session: StudioSession) => Promise<StudioSkillUsageSummary[]>
  private readonly recordSkillUsage?: StudioSessionRunnerOptions['recordSkillUsage']
  private readonly resolveTurnPlan: StudioTurnPlanResolver

  constructor(options: StudioSessionRunnerOptions) {
    this.registry = options.registry
    this.messageStore = options.messageStore
    this.processor = new StudioRunProcessor({
      messageStore: options.messageStore,
      partStore: options.partStore
    })
    this.runStore = options.runStore
    this.sessionStore = options.sessionStore
    this.sessionEventStore = options.sessionEventStore
    this.taskStore = options.taskStore
    this.workStore = options.workStore
    this.workResultStore = options.workResultStore
    this.sharedEventBus = options.eventBus
    this.resolveSkill = options.resolveSkill
    this.listSkills = options.listSkills
    this.listSkillSummaries = options.listSkillSummaries
    this.recordSkillUsage = options.recordSkillUsage
    this.resolveTurnPlan = options.resolveTurnPlan
  }

  async createAssistantMessage(session: StudioSession): Promise<StudioAssistantMessage> {
    const message = buildDraftAssistantMessage(session)
    return this.messageStore.createAssistantMessage(message)
  }

  createRun(session: StudioSession, inputText: string, metadata?: Record<string, unknown>): StudioRun {
    return buildDraftRun(session, inputText, metadata)
  }

  async run(input: StudioRunRequestInput): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const handle = await this.startBackgroundRun(input)
    return handle.completion
  }

  async startBackgroundRun(input: StudioRunRequestInput): Promise<StudioBackgroundRunHandle> {
    const prepared = await this.prepareRun(input)
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
    const prepared = await this.prepareRun(input)
    const abortController = new AbortController()
    return this.executePreparedStream(prepared, this.createResolvedPlanExecution({
      prepared,
      plan: input.plan,
      customApiConfig: input.customApiConfig,
      toolChoice: input.toolChoice,
      abortSignal: abortController.signal,
    }), abortController.signal)
  }

  async runSubagent(input: StudioSubagentRunRequest): Promise<StudioSubagentRunResult> {
    const skill = input.skillName && this.resolveSkill
      ? await this.resolveSkill(input.skillName, input.childSession)
      : undefined

    const result = await this.run({
      projectId: input.projectId,
      session: input.childSession,
      inputText: buildSubagentPrompt({
        agentType: input.subagentType,
        inputText: input.inputText,
        skillName: input.skillName,
        skill,
        files: input.files,
        studioKind: input.childSession.studioKind
      }),
      customApiConfig: input.customApiConfig,
      toolChoice: input.toolChoice ?? resolveStudioToolChoice({ session: input.childSession })
    })

    return {
      text: result.text
    }
  }

  private async prepareRun(input: StudioRunRequestInput): Promise<StudioPreparedRunContext> {
    const prepareStartedAt = Date.now()
    const workContext = await this.buildWorkContext(input)
    const run = this.createRun(input.session, input.inputText, input.runMetadata)
    const persistedRun = this.runStore ? await this.runStore.create(run) : run
    await this.messageStore.createUserMessage(createStudioUserMessage({
      sessionId: input.session.id,
      text: input.inputText
    }))
    const assistantMessage = await this.createAssistantMessage(input.session)
    const eventBus = this.sharedEventBus ?? new InMemoryStudioEventBus()

    logPlotStudioTiming(input.session.studioKind, 'run.started', {
      sessionId: input.session.id,
      runId: persistedRun.id,
      assistantMessageId: assistantMessage.id,
      prepareDurationMs: readElapsedMs(prepareStartedAt),
      hasCustomApiConfig: hasUsableCustomApiConfig(input.customApiConfig),
    })

    const runningRun = this.runStore
      ? await this.runStore.update(persistedRun.id, { status: 'running' }) ?? { ...persistedRun, status: 'running' }
      : { ...persistedRun, status: 'running' as const }

    eventBus.publish({
      type: 'run_updated',
      run: runningRun
    })

    return {
      input,
      workContext,
      run: runningRun,
      assistantMessage,
      eventBus
    }
  }

  private async executePreparedRun(prepared: StudioPreparedRunContext, abortSignal: AbortSignal) {
    throwIfStudioRunCancelled(abortSignal)
    if (hasUsableCustomApiConfig(prepared.input.customApiConfig)) {
      return this.executePreparedStream(prepared, this.createAgentLoopExecution({
        prepared,
        customApiConfig: prepared.input.customApiConfig,
        toolChoice: resolveStudioToolChoice({ session: prepared.input.session, override: prepared.input.toolChoice }),
        abortSignal,
      }), abortSignal)
    }

    const plan = await this.resolveTurnPlan({
      projectId: prepared.input.projectId,
      session: prepared.input.session,
      run: prepared.run,
      assistantMessage: prepared.assistantMessage,
      inputText: prepared.input.inputText,
      workContext: prepared.workContext
    })

    return this.executePreparedStream(prepared, this.createResolvedPlanExecution({
      prepared,
      plan,
      customApiConfig: prepared.input.customApiConfig,
      toolChoice: prepared.input.toolChoice,
      abortSignal,
    }), abortSignal)
  }

  private async buildWorkContext(input: {
    session: StudioSession
    inputText: string
  }): Promise<StudioWorkContext> {
    const draftAssistantMessage = buildDraftAssistantMessage(input.session)
    const workContext = await buildStudioWorkContext({
      sessionId: input.session.id,
      agent: input.session.agentType,
      assistantMessage: draftAssistantMessage,
      workStore: this.workStore,
      workResultStore: this.workResultStore,
      taskStore: this.taskStore,
      sessionEventStore: this.sessionEventStore
    })

    return workContext ?? {
      sessionId: input.session.id,
      agent: input.session.agentType
    }
  }

  private createResolvedPlanExecution(input: {
    prepared: StudioPreparedRunContext
    plan: StudioRuntimeTurnPlan
    customApiConfig?: CustomApiConfig
    toolChoice?: StudioToolChoice
    abortSignal: AbortSignal
  }): StudioPreparedRunExecution {
    return {
      events: createStudioTurnExecutionStream({
        projectId: input.prepared.input.projectId,
        session: input.prepared.input.session,
        run: input.prepared.run,
        assistantMessage: input.prepared.assistantMessage,
        plan: input.plan,
        registry: this.registry,
        eventBus: input.prepared.eventBus,
        sessionStore: this.sessionStore,
        taskStore: this.taskStore,
        workStore: this.workStore,
        workResultStore: this.workResultStore,
        runSubagent: (request) => this.runSubagent({
          ...request,
          customApiConfig: input.customApiConfig,
          toolChoice: input.toolChoice
        }),
        resolveSkill: this.resolveSkill,
        listSkills: this.listSkills,
        listSkillSummaries: this.listSkillSummaries,
        recordSkillUsage: this.recordSkillUsage,
        setToolMetadata: (callId, metadata) => {
          void this.processor.applyToolMetadata({
            assistantMessage: input.prepared.assistantMessage,
            callId,
            title: metadata.title,
            metadata: metadata.metadata
          })
        },
        customApiConfig: input.customApiConfig,
        abortSignal: input.abortSignal,
      })
    }
  }

  private createAgentLoopExecution(input: {
    prepared: StudioPreparedRunContext
    customApiConfig: CustomApiConfig
    toolChoice?: StudioToolChoice
    abortSignal: AbortSignal
  }): StudioPreparedRunExecution {
    return {
      startLog: {
        event: 'loop.started',
        payload: {
          sessionId: input.prepared.input.session.id,
          runId: input.prepared.run.id,
          model: input.customApiConfig.model,
          toolChoice: input.toolChoice ?? null,
          runElapsedMs: readRunElapsedMs(input.prepared.run),
        }
      },
      events: createStudioOpenAIToolLoop({
        projectId: input.prepared.input.projectId,
        session: input.prepared.input.session,
        run: input.prepared.run,
        assistantMessage: input.prepared.assistantMessage,
        inputText: input.prepared.input.inputText,
        messageStore: this.messageStore,
        registry: this.registry,
        eventBus: input.prepared.eventBus,
        sessionStore: this.sessionStore,
        taskStore: this.taskStore,
        workStore: this.workStore,
        workResultStore: this.workResultStore,
        workContext: input.prepared.workContext,
        runSubagent: (request) => this.runSubagent({
          ...request,
          customApiConfig: input.customApiConfig,
          toolChoice: input.toolChoice
        }),
        resolveSkill: this.resolveSkill,
        listSkills: this.listSkills,
        listSkillSummaries: this.listSkillSummaries,
        recordSkillUsage: this.recordSkillUsage,
        createAssistantMessage: () => this.createAssistantMessage(input.prepared.input.session),
        setToolMetadata: (assistantMessage, callId, metadata) => {
          void this.processor.applyToolMetadata({
            assistantMessage,
            callId,
            title: metadata.title,
            metadata: metadata.metadata
          })
        },
        customApiConfig: input.customApiConfig,
        toolChoice: input.toolChoice,
        abortSignal: input.abortSignal,
        onCheckpoint: async (patch) => {
          const nextRun = this.runStore
            ? await this.runStore.update(input.prepared.run.id, patch) ?? { ...input.prepared.run, ...patch }
            : { ...input.prepared.run, ...patch }
          input.prepared.run = nextRun
          input.prepared.eventBus.publish({
            type: 'run_updated',
            run: nextRun
          })
        }
      })
    }
  }

  private async executePreparedStream(
    prepared: StudioPreparedRunContext,
    execution: StudioPreparedRunExecution,
    abortSignal: AbortSignal,
  ): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    try {
      throwIfStudioRunCancelled(abortSignal)
      if (execution.startLog) {
        logPlotStudioTiming(prepared.input.session.studioKind, execution.startLog.event, execution.startLog.payload)
      }

      const outcome = await this.processor.processStream({
        session: prepared.input.session,
        run: prepared.run,
        assistantMessage: prepared.assistantMessage,
        eventBus: prepared.eventBus,
        events: execution.events
      })

      return this.finalizeSuccessfulRun({
        input: { session: prepared.input.session },
        run: prepared.run,
        assistantMessage: prepared.assistantMessage,
        outcome,
        eventBus: prepared.eventBus
      })
    } catch (error) {
      if (isStudioRunCancelledError(error)) {
        return this.handleCancelledRun({
          input: { session: prepared.input.session },
          run: prepared.run,
          reason: error.reason,
        })
      }
      return this.handleFailedRun({
        input: { session: prepared.input.session },
        run: prepared.run,
        error
      })
    }
  }

  private async handleCancelledRun(input: {
    input: { session: StudioSession }
    run: StudioRun
    reason: string
  }): Promise<never> {
    const cancelledRun = cancelRunState(input.run, input.reason)
    await this.runStore?.update(input.run.id, cancelledRun)
    ;(this.sharedEventBus ?? new InMemoryStudioEventBus()).publish({
      type: 'run_updated',
      run: cancelledRun
    })

    logPlotStudioTiming(input.input.session.studioKind, 'run.failed', {
      sessionId: input.input.session.id,
      runId: input.run.id,
      error: input.reason,
      cancelled: true,
      runElapsedMs: readRunElapsedMs(cancelledRun),
    }, 'warn')

    throw new Error(input.reason)
  }

  private async finalizeSuccessfulRun(input: {
    input: { session: StudioSession }
    run: StudioRun
    assistantMessage: StudioAssistantMessage
    outcome: 'continue' | 'stop' | 'compact'
    eventBus: StudioEventBus
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const finishedRun = finalizeRunState({ run: input.run, outcome: input.outcome })
    await this.runStore?.update(input.run.id, finishedRun)
    input.eventBus.publish({
      type: 'run_updated',
      run: finishedRun
    })

    const finalAssistantMessage = await this.findLatestAssistantMessage(
      input.input.session.id,
      input.assistantMessage,
    )

    logPlotStudioTiming(input.input.session.studioKind, 'run.completed', {
      sessionId: input.input.session.id,
      runId: input.run.id,
      outcome: input.outcome,
      eventCount: input.eventBus.list().length,
      runElapsedMs: readRunElapsedMs(finishedRun),
    })

    return {
      run: finishedRun,
      assistantMessage: finalAssistantMessage,
      text: extractLatestAssistantText(finalAssistantMessage.parts)
    }
  }

  private async handleFailedRun(input: {
    input: { session: StudioSession }
    run: StudioRun
    error: unknown
  }): Promise<never> {
    const message = input.error instanceof Error ? input.error.message : String(input.error)
    const failedRun = failRunState(input.run, message)
    await this.runStore?.update(input.run.id, failedRun)
    ;(this.sharedEventBus ?? new InMemoryStudioEventBus()).publish({
      type: 'run_updated',
      run: failedRun
    })

    logPlotStudioTiming(input.input.session.studioKind, 'run.failed', {
      sessionId: input.input.session.id,
      runId: input.run.id,
      error: message,
      runElapsedMs: readRunElapsedMs(failedRun),
    }, 'warn')

    throw input.error
  }

  private async findLatestAssistantMessage(
    sessionId: string,
    fallback: StudioAssistantMessage,
  ): Promise<StudioAssistantMessage> {
    const messages = await this.messageStore.listBySessionId(sessionId)
    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message): message is StudioAssistantMessage => message.role === 'assistant')

    const resolved = latestAssistantMessage ?? fallback

    return resolved
  }
}

function hasUsableCustomApiConfig(config?: CustomApiConfig): config is CustomApiConfig {
  if (!config) {
    return false
  }

  return [config.apiUrl, config.apiKey, config.model].every((value) => typeof value === 'string' && value.trim().length > 0)
}
