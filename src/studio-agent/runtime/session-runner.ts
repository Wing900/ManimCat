import { createLogger } from '../../utils/logger'
import type { CustomApiConfig } from '../../types'
import { InMemoryStudioEventBus } from '../events/event-bus'
import { createStudioUserMessage } from '../domain/factories'
import type { StudioPermissionService } from '../permissions/permission-service'
import { createStudioOpenAIToolLoop } from '../orchestration/studio-openai-tool-loop'
import { createStudioTurnExecutionStream } from './tool-execution-stream'
import { StudioRunProcessor } from './run-processor'
import type { StudioTurnPlanResolver } from './turn-plan-resolver'
import type {
  StudioResolvedSkill,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from './tool-runtime-context'
import {
  buildDraftAssistantMessage,
  buildDraftRun,
  buildSubagentPrompt,
  extractLatestAssistantText,
  failRunState,
  finalizeRunState
} from './session-runner-helpers'
import { buildStudioWorkContext } from './work-context'
import { resolveStudioToolChoice } from './session-agent-config'
import type {
  StudioAssistantMessage,
  StudioEventBus,
  StudioMessageStore,
  StudioPartStore,
  StudioPermissionDecision,
  StudioPermissionRequest,
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
} from '../domain/types'
import { StudioToolRegistry } from '../tools/registry'

const logger = createLogger('StudioSessionRunner')

interface StudioSessionRunnerOptions {
  registry: StudioToolRegistry
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore?: StudioRunStore
  sessionStore?: StudioSessionStore
  sessionEventStore?: StudioSessionEventStore
  permissionService?: StudioPermissionService
  askForConfirmation?: (request: StudioPermissionRequest) => Promise<StudioPermissionDecision>
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  eventBus?: StudioEventBus
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
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

export interface StudioBackgroundRunHandle {
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  completion: Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }>
}

export class StudioSessionRunner {
  private readonly registry: StudioToolRegistry
  private readonly processor: StudioRunProcessor
  private readonly messageStore: StudioMessageStore
  private readonly runStore?: StudioRunStore
  private readonly sessionStore?: StudioSessionStore
  private readonly sessionEventStore?: StudioSessionEventStore
  private readonly permissionService?: StudioPermissionService
  private readonly askForConfirmation: (request: StudioPermissionRequest) => Promise<StudioPermissionDecision>
  private readonly taskStore?: StudioTaskStore
  private readonly workStore?: StudioWorkStore
  private readonly workResultStore?: StudioWorkResultStore
  private readonly sharedEventBus?: StudioEventBus
  private readonly resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
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
    this.permissionService = options.permissionService
    this.taskStore = options.taskStore
    this.workStore = options.workStore
    this.workResultStore = options.workResultStore
    this.sharedEventBus = options.eventBus
    this.resolveSkill = options.resolveSkill
    this.resolveTurnPlan = options.resolveTurnPlan
    this.askForConfirmation = options.askForConfirmation ?? (async () => 'reject')
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
    return {
      run: prepared.run,
      assistantMessage: prepared.assistantMessage,
      completion: this.executePreparedRun(prepared)
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
    return this.executeResolvedPlan({
      prepared,
      plan: input.plan,
      customApiConfig: input.customApiConfig,
      toolChoice: input.toolChoice
    })
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
    const workContext = await this.buildWorkContext(input)
    const run = this.createRun(input.session, input.inputText, input.runMetadata)
    const persistedRun = this.runStore ? await this.runStore.create(run) : run
    await this.messageStore.createUserMessage(createStudioUserMessage({
      sessionId: input.session.id,
      text: input.inputText
    }))
    const assistantMessage = await this.createAssistantMessage(input.session)
    const eventBus = this.sharedEventBus ?? new InMemoryStudioEventBus()

    logger.info('Prepared Studio run context', {
      sessionId: input.session.id,
      runId: persistedRun.id,
      agent: input.session.agentType,
      inputTextLength: input.inputText.length,
      assistantMessageId: assistantMessage.id,
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

  private async executePreparedRun(prepared: StudioPreparedRunContext) {
    if (hasUsableCustomApiConfig(prepared.input.customApiConfig)) {
      return this.executeAgentLoop({
        prepared,
        customApiConfig: prepared.input.customApiConfig,
        toolChoice: resolveStudioToolChoice({ session: prepared.input.session, override: prepared.input.toolChoice })
      })
    }

    const plan = await this.resolveTurnPlan({
      projectId: prepared.input.projectId,
      session: prepared.input.session,
      run: prepared.run,
      assistantMessage: prepared.assistantMessage,
      inputText: prepared.input.inputText,
      workContext: prepared.workContext
    })

    return this.executeResolvedPlan({
      prepared,
      plan,
      customApiConfig: prepared.input.customApiConfig,
      toolChoice: prepared.input.toolChoice
    })
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

  private async executeResolvedPlan(input: {
    prepared: StudioPreparedRunContext
    plan: StudioRuntimeTurnPlan
    customApiConfig?: CustomApiConfig
    toolChoice?: StudioToolChoice
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    try {
      const outcome = await this.processor.processStream({
        session: input.prepared.input.session,
        run: input.prepared.run,
        assistantMessage: input.prepared.assistantMessage,
        eventBus: input.prepared.eventBus,
        events: createStudioTurnExecutionStream({
          projectId: input.prepared.input.projectId,
          session: input.prepared.input.session,
          run: input.prepared.run,
          assistantMessage: input.prepared.assistantMessage,
          plan: input.plan,
          registry: this.registry,
          eventBus: input.prepared.eventBus,
          permissionService: this.permissionService,
          sessionStore: this.sessionStore,
          taskStore: this.taskStore,
          workStore: this.workStore,
          workResultStore: this.workResultStore,
          askForConfirmation: this.askForConfirmation,
          runSubagent: (request) => this.runSubagent({
            ...request,
            customApiConfig: input.customApiConfig,
            toolChoice: input.toolChoice
          }),
          resolveSkill: this.resolveSkill,
          setToolMetadata: (callId, metadata) => {
            void this.processor.applyToolMetadata({
              assistantMessage: input.prepared.assistantMessage,
              callId,
              title: metadata.title,
              metadata: metadata.metadata
            })
          },
          customApiConfig: input.customApiConfig
        })
      })

      return this.finalizeSuccessfulRun({
        input: { session: input.prepared.input.session },
        run: input.prepared.run,
        assistantMessage: input.prepared.assistantMessage,
        outcome,
        eventBus: input.prepared.eventBus
      })
    } catch (error) {
      return this.handleFailedRun({
        input: { session: input.prepared.input.session },
        run: input.prepared.run,
        error
      })
    }
  }

  private async executeAgentLoop(input: {
    prepared: StudioPreparedRunContext
    customApiConfig: CustomApiConfig
    toolChoice?: StudioToolChoice
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    try {
      const outcome = await this.processor.processStream({
        session: input.prepared.input.session,
        run: input.prepared.run,
        assistantMessage: input.prepared.assistantMessage,
        eventBus: input.prepared.eventBus,
        events: createStudioOpenAIToolLoop({
          projectId: input.prepared.input.projectId,
          session: input.prepared.input.session,
          run: input.prepared.run,
          assistantMessage: input.prepared.assistantMessage,
          inputText: input.prepared.input.inputText,
          messageStore: this.messageStore,
          registry: this.registry,
          eventBus: input.prepared.eventBus,
          permissionService: this.permissionService,
          sessionStore: this.sessionStore,
          taskStore: this.taskStore,
          workStore: this.workStore,
          workResultStore: this.workResultStore,
          workContext: input.prepared.workContext,
          askForConfirmation: this.askForConfirmation,
          runSubagent: (request) => this.runSubagent({
            ...request,
            customApiConfig: input.customApiConfig,
            toolChoice: input.toolChoice
          }),
          resolveSkill: this.resolveSkill,
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
      })

      return this.finalizeSuccessfulRun({
        input: { session: input.prepared.input.session },
        run: input.prepared.run,
        assistantMessage: input.prepared.assistantMessage,
        outcome,
        eventBus: input.prepared.eventBus
      })
    } catch (error) {
      return this.handleFailedRun({
        input: { session: input.prepared.input.session },
        run: input.prepared.run,
        error
      })
    }
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

    logger.info('Studio session run completed', {
      sessionId: input.input.session.id,
      runId: input.run.id,
      agent: input.input.session.agentType,
      outcome: input.outcome,
      eventCount: input.eventBus.list().length
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

    logger.warn('Studio session run failed', {
      sessionId: input.input.session.id,
      runId: input.run.id,
      agent: input.input.session.agentType,
      error: message
    })

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

    logger.info('Resolved final assistant message for run', {
      sessionId,
      fallbackMessageId: fallback.id,
      resolvedMessageId: resolved.id,
      messageCount: messages.length,
    })

    return resolved
  }
}

function hasUsableCustomApiConfig(config?: CustomApiConfig): config is CustomApiConfig {
  if (!config) {
    return false
  }

  return [config.apiUrl, config.apiKey, config.model].every((value) => typeof value === 'string' && value.trim().length > 0)
}





