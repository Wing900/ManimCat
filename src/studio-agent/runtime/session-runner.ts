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
  StudioSessionStore,
  StudioTaskStore,
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
  permissionService?: StudioPermissionService
  askForConfirmation?: (request: StudioPermissionRequest) => Promise<StudioPermissionDecision>
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  eventBus?: StudioEventBus
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  resolveTurnPlan: StudioTurnPlanResolver
}

export class StudioSessionRunner {
  private readonly registry: StudioToolRegistry
  private readonly processor: StudioRunProcessor
  private readonly messageStore: StudioMessageStore
  private readonly runStore?: StudioRunStore
  private readonly sessionStore?: StudioSessionStore
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

  createRun(session: StudioSession, inputText: string): StudioRun {
    return buildDraftRun(session, inputText)
  }

  async run(input: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: CustomApiConfig
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const workContext = await this.buildWorkContext(input)

    if (hasUsableCustomApiConfig(input.customApiConfig)) {
      return this.runWithAgentLoop({
        ...input,
        customApiConfig: input.customApiConfig,
        workContext
      })
    }

    const plan = await this.resolveTurnPlan({
      projectId: input.projectId,
      session: input.session,
      run: buildDraftRun(input.session, input.inputText),
      assistantMessage: buildDraftAssistantMessage(input.session),
      inputText: input.inputText,
      workContext
    })

    return this.runWithResolvedPlan({
      ...input,
      plan,
      workContext
    })
  }

  async runWithPlan(input: {
    projectId: string
    session: StudioSession
    inputText: string
    plan: StudioRuntimeTurnPlan
    customApiConfig?: CustomApiConfig
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const workContext = await this.buildWorkContext(input)
    return this.runWithResolvedPlan({
      ...input,
      workContext
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
        files: input.files
      }),
      customApiConfig: input.customApiConfig
    })

    return {
      text: result.text
    }
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
      taskStore: this.taskStore
    })

    return workContext ?? {
      sessionId: input.session.id,
      agent: input.session.agentType
    }
  }

  private async runWithResolvedPlan(input: {
    projectId: string
    session: StudioSession
    inputText: string
    plan: StudioRuntimeTurnPlan
    workContext: StudioWorkContext
    customApiConfig?: CustomApiConfig
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const run = this.createRun(input.session, input.inputText)
    const persistedRun = this.runStore ? await this.runStore.create(run) : run
    await this.messageStore.createUserMessage(createStudioUserMessage({
      sessionId: input.session.id,
      text: input.inputText
    }))
    const assistantMessage = await this.createAssistantMessage(input.session)

    await this.runStore?.update(persistedRun.id, { status: 'running' })

    try {
      const eventBus = this.sharedEventBus ?? new InMemoryStudioEventBus()
      const outcome = await this.processor.processStream({
        session: input.session,
        run: persistedRun,
        assistantMessage,
        events: createStudioTurnExecutionStream({
          projectId: input.projectId,
          session: input.session,
          run: persistedRun,
          assistantMessage,
          plan: input.plan,
          registry: this.registry,
          eventBus,
          permissionService: this.permissionService,
          sessionStore: this.sessionStore,
          taskStore: this.taskStore,
          workStore: this.workStore,
          workResultStore: this.workResultStore,
          askForConfirmation: this.askForConfirmation,
          runSubagent: (request) => this.runSubagent({
            ...request,
            customApiConfig: input.customApiConfig
          }),
          resolveSkill: this.resolveSkill,
          setToolMetadata: (callId, metadata) => {
            void this.processor.applyToolMetadata({
              assistantMessage,
              callId,
              title: metadata.title,
              metadata: metadata.metadata
            })
          },
          customApiConfig: input.customApiConfig
        })
      })

      return this.finalizeSuccessfulRun({
        input,
        run: persistedRun,
        assistantMessage,
        outcome,
        eventBus
      })
    } catch (error) {
      return this.handleFailedRun({
        input,
        run: persistedRun,
        error
      })
    }
  }

  private async runWithAgentLoop(input: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig: CustomApiConfig
    workContext: StudioWorkContext
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    const run = this.createRun(input.session, input.inputText)
    const persistedRun = this.runStore ? await this.runStore.create(run) : run
    await this.messageStore.createUserMessage(createStudioUserMessage({
      sessionId: input.session.id,
      text: input.inputText
    }))
    const assistantMessage = await this.createAssistantMessage(input.session)

    await this.runStore?.update(persistedRun.id, { status: 'running' })

    try {
      const eventBus = this.sharedEventBus ?? new InMemoryStudioEventBus()
      const outcome = await this.processor.processStream({
        session: input.session,
        run: persistedRun,
        assistantMessage,
        events: createStudioOpenAIToolLoop({
          projectId: input.projectId,
          session: input.session,
          run: persistedRun,
          assistantMessage,
          inputText: input.inputText,
          messageStore: this.messageStore,
          registry: this.registry,
          eventBus,
          permissionService: this.permissionService,
          sessionStore: this.sessionStore,
          taskStore: this.taskStore,
          workStore: this.workStore,
          workResultStore: this.workResultStore,
          workContext: input.workContext,
          askForConfirmation: this.askForConfirmation,
          runSubagent: (request) => this.runSubagent({
            ...request,
            customApiConfig: input.customApiConfig
          }),
          resolveSkill: this.resolveSkill,
          setToolMetadata: (callId, metadata) => {
            void this.processor.applyToolMetadata({
              assistantMessage,
              callId,
              title: metadata.title,
              metadata: metadata.metadata
            })
          },
          customApiConfig: input.customApiConfig
        })
      })

      return this.finalizeSuccessfulRun({
        input,
        run: persistedRun,
        assistantMessage,
        outcome,
        eventBus
      })
    } catch (error) {
      return this.handleFailedRun({
        input,
        run: persistedRun,
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

    logger.info('Studio session run completed', {
      sessionId: input.input.session.id,
      runId: input.run.id,
      agent: input.input.session.agentType,
      outcome: input.outcome,
      eventCount: input.eventBus.list().length
    })

    return {
      run: finishedRun,
      assistantMessage: input.assistantMessage,
      text: extractLatestAssistantText(input.assistantMessage.parts)
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
}

function hasUsableCustomApiConfig(config?: CustomApiConfig): config is CustomApiConfig {
  if (!config) {
    return false
  }

  return [config.apiUrl, config.apiKey, config.model].every((value) => typeof value === 'string' && value.trim().length > 0)
}

