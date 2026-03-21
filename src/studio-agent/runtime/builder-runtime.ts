import type { CustomApiConfig } from '../../types'
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
  StudioWorkResultStore,
  StudioWorkStore
} from '../domain/types'
import type { StudioPermissionService } from '../permissions/permission-service'
import { StudioToolRegistry } from '../tools/registry'
import { StudioSessionRunner } from './session-runner'
import type { StudioTurnPlanResolver } from './turn-plan-resolver'
import type {
  StudioResolvedSkill,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from './tool-runtime-context'

interface StudioBuilderRuntimeOptions {
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
  resolveTurnPlan: StudioTurnPlanResolver
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
}

export class StudioBuilderRuntime {
  private readonly runner: StudioSessionRunner

  constructor(options: StudioBuilderRuntimeOptions) {
    this.runner = new StudioSessionRunner({
      registry: options.registry,
      messageStore: options.messageStore,
      partStore: options.partStore,
      runStore: options.runStore,
      sessionStore: options.sessionStore,
      permissionService: options.permissionService,
      askForConfirmation: options.askForConfirmation,
      taskStore: options.taskStore,
      workStore: options.workStore,
      workResultStore: options.workResultStore,
      eventBus: options.eventBus,
      resolveTurnPlan: options.resolveTurnPlan,
      resolveSkill: options.resolveSkill
    })
  }

  async createAssistantMessage(session: StudioSession): Promise<StudioAssistantMessage> {
    return this.runner.createAssistantMessage(session)
  }

  createRun(session: StudioSession, inputText: string): StudioRun {
    return this.runner.createRun(session, inputText)
  }

  async executePlan(input: {
    projectId: string
    session: StudioSession
    run: StudioRun
    assistantMessage: StudioAssistantMessage
    plan: StudioRuntimeTurnPlan
    customApiConfig?: CustomApiConfig
  }): Promise<void> {
    await this.runner.runWithPlan({
      projectId: input.projectId,
      session: input.session,
      inputText: input.run.inputText,
      plan: input.plan,
      customApiConfig: input.customApiConfig
    })
  }

  async run(input: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: CustomApiConfig
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    return this.runner.run(input)
  }

  async runSubagent(input: StudioSubagentRunRequest): Promise<StudioSubagentRunResult> {
    return this.runner.runSubagent(input)
  }
}
