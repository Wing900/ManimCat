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
  StudioSessionEventStore,
  StudioSessionStore,
  StudioTaskStore,
  StudioToolChoice,
  StudioWorkResultStore,
  StudioWorkStore
} from '../domain/types'
import type { StudioPermissionService } from '../permissions/permission-service'
import { StudioToolRegistry } from '../tools/registry'
import { StudioSessionRunner, type StudioBackgroundRunHandle } from './execution/session-runner'
import type { StudioTurnPlanResolver } from './planning/turn-plan-resolver'
import type {
  StudioResolvedSkill,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from './tools/tool-runtime-context'

interface StudioBuilderRuntimeOptions {
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
  resolveTurnPlan: StudioTurnPlanResolver
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
      sessionEventStore: options.sessionEventStore,
      permissionService: options.permissionService,
      askForConfirmation: options.askForConfirmation,
      taskStore: options.taskStore,
      workStore: options.workStore,
      workResultStore: options.workResultStore,
      eventBus: options.eventBus,
      resolveTurnPlan: options.resolveTurnPlan,
      resolveSkill: options.resolveSkill,
      listSkills: options.listSkills,
      listSkillSummaries: options.listSkillSummaries,
      recordSkillUsage: options.recordSkillUsage
    })
  }

  async createAssistantMessage(session: StudioSession): Promise<StudioAssistantMessage> {
    return this.runner.createAssistantMessage(session)
  }

  createRun(session: StudioSession, inputText: string, metadata?: Record<string, unknown>): StudioRun {
    return this.runner.createRun(session, inputText, metadata)
  }

  async executePlan(input: {
    projectId: string
    session: StudioSession
    run: StudioRun
    assistantMessage: StudioAssistantMessage
    plan: StudioRuntimeTurnPlan
    customApiConfig?: CustomApiConfig
    toolChoice?: StudioToolChoice
  }): Promise<void> {
    await this.runner.runWithPlan({
      projectId: input.projectId,
      session: input.session,
      inputText: input.run.inputText,
      plan: input.plan,
      customApiConfig: input.customApiConfig,
      toolChoice: input.toolChoice
    })
  }

  async run(input: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: CustomApiConfig
    toolChoice?: StudioToolChoice
    runMetadata?: Record<string, unknown>
  }): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
    return this.runner.run(input)
  }

  async startBackgroundRun(input: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: CustomApiConfig
    toolChoice?: StudioToolChoice
    runMetadata?: Record<string, unknown>
  }): Promise<StudioBackgroundRunHandle> {
    return this.runner.startBackgroundRun(input)
  }

  abortBackgroundRun(handle: StudioBackgroundRunHandle, reason?: string): void {
    handle.abort(reason)
  }

  async runSubagent(input: StudioSubagentRunRequest): Promise<StudioSubagentRunResult> {
    return this.runner.runSubagent(input)
  }
}
