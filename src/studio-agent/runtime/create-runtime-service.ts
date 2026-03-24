import fs from 'node:fs'
import { createStudioSession } from '../domain/factories'
import type {
  StudioEventBus,
  StudioKind,
  StudioPermissionLevel,
  StudioPermissionReply,
  StudioPermissionRequest,
  StudioSession,
  StudioTask,
  StudioToolChoice,
  StudioWork,
  StudioWorkResult,
} from '../domain/types'
import { InMemoryStudioEventBus, type StudioEventListener } from '../events/event-bus'
import { adaptStudioEvent, type StudioExternalEvent } from '../events/studio-event-adapter'
import { registerManimStudioTools } from '../manim/register-manim-tools'
import type { StudioPersistence } from '../persistence/studio-persistence'
import { registerPlotStudioTools } from '../plot/register-plot-tools'
import type { StudioPermissionService } from '../permissions/permission-service'
import { defaultRulesForLevel } from '../permissions/policy'
import { resolveStudioPermissionMode, type StudioPermissionMode } from '../session-control/permission-modes'
import { registerSharedStudioTools } from '../shared/register-shared-tools'
import { createLocalStudioSkillResolver } from '../skills/local-skill-resolver'
import type { StudioBlobStore } from '../storage/studio-blob-store'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import { createStudioDefaultTurnPlanResolver } from './default-turn-plan-resolver'
import { syncStudioRenderTask } from './render-task-sync'
import { createStudioSessionMetadata } from './session-agent-config'
import { flushTerminalSessionEventsToAssistant } from './session-event-inbox'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'

interface SubscribableStudioEventBus extends StudioEventBus {
  subscribe: (listener: StudioEventListener) => () => void
}

interface CreateStudioRuntimeServiceInput {
  persistence: StudioPersistence
  permissionService: StudioPermissionService
  workspaceProvider: StudioWorkspaceProvider
  blobStore: StudioBlobStore
  registry?: StudioToolRegistry
  eventBus?: SubscribableStudioEventBus
}

export interface StudioRuntimeService {
  registry: StudioToolRegistry
  runtime: StudioBuilderRuntime
  permissionService: StudioPermissionService
  workspaceProvider: StudioWorkspaceProvider
  blobStore: StudioBlobStore
  sessionStore: StudioPersistence['sessionStore']
  messageStore: StudioPersistence['messageStore']
  partStore: StudioPersistence['partStore']
  runStore: StudioPersistence['runStore']
  taskStore: StudioPersistence['taskStore']
  workStore: StudioPersistence['workStore']
  workResultStore: StudioPersistence['workResultStore']
  sessionEventStore: StudioPersistence['sessionEventStore']
  eventBus: StudioEventBus
  createSession: (sessionInput: {
    projectId: string
    directory: string
    useDedicatedWorkspace?: boolean
    title?: string
    studioKind?: StudioKind
    agentType?: StudioSession['agentType']
    permissionLevel?: StudioPermissionLevel
    workspaceId?: string
    toolChoice?: StudioToolChoice
  }) => Promise<StudioSession>
  getSession: (sessionId: string) => Promise<StudioSession | null>
  updateSession: (sessionId: string, patch: {
    permissionMode?: StudioPermissionMode
  }) => Promise<StudioSession | null>
  syncSession: (sessionId: string) => Promise<void>
  listWorkResultsBySessionId: (sessionId: string) => Promise<StudioWorkResult[]>
  listExternalEvents: () => StudioExternalEvent[]
  subscribeExternalEvents: (listener: (event: StudioExternalEvent) => void) => () => void
  listPendingPermissions: () => StudioPermissionRequest[]
  replyPermission: (replyInput: StudioPermissionReply) => boolean
}

export function createStudioRuntimeService(input: CreateStudioRuntimeServiceInput): StudioRuntimeService {
  const registry = input.registry ?? new StudioToolRegistry()
  const eventBus: SubscribableStudioEventBus = input.eventBus ?? new InMemoryStudioEventBus()
  const externalEventLog: StudioExternalEvent[] = []

  registerSharedStudioTools(registry)
  registerManimStudioTools(registry)
  registerPlotStudioTools(registry)

  const resolveSkill = createLocalStudioSkillResolver()
  const resolveTurnPlan = createStudioDefaultTurnPlanResolver({ registry })

  const runtime = new StudioBuilderRuntime({
    registry,
    messageStore: input.persistence.messageStore,
    partStore: input.persistence.partStore,
    runStore: input.persistence.runStore,
    sessionStore: input.persistence.sessionStore,
    taskStore: input.persistence.taskStore,
    workStore: input.persistence.workStore,
    workResultStore: input.persistence.workResultStore,
    sessionEventStore: input.persistence.sessionEventStore,
    permissionService: input.permissionService,
    resolveTurnPlan,
    resolveSkill,
    eventBus,
  })

  eventBus.subscribe((event) => {
    const adapted = adaptStudioEvent(event)
    if (adapted) {
      externalEventLog.push(adapted)
    }
  })

  return {
    registry,
    runtime,
    permissionService: input.permissionService,
    workspaceProvider: input.workspaceProvider,
    blobStore: input.blobStore,
    sessionStore: input.persistence.sessionStore,
    messageStore: input.persistence.messageStore,
    partStore: input.persistence.partStore,
    runStore: input.persistence.runStore,
    taskStore: input.persistence.taskStore,
    workStore: input.persistence.workStore,
    workResultStore: input.persistence.workResultStore,
    sessionEventStore: input.persistence.sessionEventStore,
    eventBus,
    async createSession(sessionInput) {
      const permissionLevel = sessionInput.permissionLevel ?? 'L2'
      const studioKind = sessionInput.studioKind ?? 'manim'
      const normalizedDirectory = input.workspaceProvider.normalizeDirectory(sessionInput.directory)
      const session = createStudioSession({
        projectId: sessionInput.projectId,
        workspaceId: sessionInput.workspaceId,
        studioKind,
        agentType: sessionInput.agentType ?? 'builder',
        title: sessionInput.title ?? getDefaultSessionTitle(studioKind),
        directory: normalizedDirectory,
        permissionLevel,
        permissionRules: defaultRulesForLevel(permissionLevel),
        metadata: createStudioSessionMetadata({
          existing: { studioKind },
          agentConfig: {
            toolChoice: sessionInput.toolChoice,
          },
        }),
      })

      if (sessionInput.useDedicatedWorkspace !== false) {
        session.directory = input.workspaceProvider.normalizeDirectory(
          `${studioKind}-studio/${session.id}`,
          { session },
        )
      }

      fs.mkdirSync(session.directory, { recursive: true })

      return input.persistence.sessionStore.create(session)
    },
    getSession(sessionId: string) {
      return input.persistence.sessionStore.getById(sessionId)
    },
    async updateSession(sessionId, patch) {
      const session = await input.persistence.sessionStore.getById(sessionId)
      if (!session) {
        return null
      }

      if (patch.permissionMode) {
        const nextMode = resolveStudioPermissionMode(patch.permissionMode, session)
        return input.persistence.sessionStore.update(sessionId, {
          permissionLevel: nextMode.permissionLevel,
          permissionRules: nextMode.permissionRules,
          metadata: nextMode.metadata,
        })
      }

      return session
    },
    async syncSession(sessionId: string): Promise<void> {
      const tasks = await input.persistence.taskStore.listBySessionId(sessionId)
      for (const task of tasks) {
        await syncTaskState({
          task,
          persistence: input.persistence,
          eventBus,
          blobStore: input.blobStore,
        })
      }

      await flushTerminalSessionEventsToAssistant({
        sessionId,
        sessionEventStore: input.persistence.sessionEventStore,
        messageStore: input.persistence.messageStore,
        partStore: input.persistence.partStore,
      })
    },
    async listWorkResultsBySessionId(sessionId: string): Promise<StudioWorkResult[]> {
      const works = await input.persistence.workStore.listBySessionId(sessionId)
      return collectWorkResults(works, input.persistence)
    },
    listExternalEvents(): StudioExternalEvent[] {
      return [...externalEventLog]
    },
    subscribeExternalEvents(listener: (event: StudioExternalEvent) => void): () => void {
      return eventBus.subscribe((event) => {
        const adapted = adaptStudioEvent(event)
        if (adapted) {
          listener(adapted)
        }
      })
    },
    listPendingPermissions(): StudioPermissionRequest[] {
      return input.permissionService.listPending()
    },
    replyPermission(replyInput: StudioPermissionReply): boolean {
      return input.permissionService.reply(replyInput)
    },
  }
}

async function syncTaskState(input: {
  task: StudioTask
  persistence: StudioPersistence
  eventBus: StudioEventBus
  blobStore: StudioBlobStore
}): Promise<void> {
  if (input.task.type !== 'render') {
    return
  }

  await syncStudioRenderTask({
    task: input.task,
    taskStore: input.persistence.taskStore,
    workStore: input.persistence.workStore,
    workResultStore: input.persistence.workResultStore,
    sessionStore: input.persistence.sessionStore,
    sessionEventStore: input.persistence.sessionEventStore,
    messageStore: input.persistence.messageStore,
    partStore: input.persistence.partStore,
    eventBus: input.eventBus,
    blobStore: input.blobStore,
  })
}

async function collectWorkResults(works: StudioWork[], persistence: StudioPersistence): Promise<StudioWorkResult[]> {
  const resultSets = await Promise.all(works.map((work) => persistence.workResultStore.listByWorkId(work.id)))
  return resultSets.flat()
}

function getDefaultSessionTitle(studioKind: StudioKind): string {
  return studioKind === 'plot' ? 'Plot Studio Session' : 'Manim Studio Session'
}
