import { createStudioSession } from '../domain/factories'
import type {
  StudioEventBus,
  StudioPermissionLevel,
  StudioPermissionReply,
  StudioPermissionRequest,
  StudioSession,
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from '../domain/types'
import { InMemoryStudioEventBus, type StudioEventListener } from '../events/event-bus'
import { adaptStudioEvent, type StudioExternalEvent } from '../events/studio-event-adapter'
import type { StudioPersistence } from '../persistence/studio-persistence'
import type { StudioPermissionService } from '../permissions/permission-service'
import { defaultRulesForLevel } from '../permissions/policy'
import { createLocalStudioSkillResolver } from '../skills/local-skill-resolver'
import type { StudioBlobStore } from '../storage/studio-blob-store'
import { createPlaceholderStudioTools } from '../tools/placeholder-tools'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import { createStudioDefaultTurnPlanResolver } from './default-turn-plan-resolver'
import { syncStudioRenderTask } from './render-task-sync'
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
  eventBus: StudioEventBus
  createSession: (sessionInput: {
    projectId: string
    directory: string
    title?: string
    agentType?: StudioSession['agentType']
    permissionLevel?: StudioPermissionLevel
    workspaceId?: string
  }) => Promise<StudioSession>
  getSession: (sessionId: string) => Promise<StudioSession | null>
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

  for (const tool of createPlaceholderStudioTools()) {
    registry.register(tool)
  }

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
    eventBus,
    async createSession(sessionInput) {
      const permissionLevel = sessionInput.permissionLevel ?? 'L2'
      const normalizedDirectory = input.workspaceProvider.normalizeDirectory(sessionInput.directory)

      return input.persistence.sessionStore.create(
        createStudioSession({
          projectId: sessionInput.projectId,
          workspaceId: sessionInput.workspaceId,
          agentType: sessionInput.agentType ?? 'builder',
          title: sessionInput.title ?? 'Studio Session',
          directory: normalizedDirectory,
          permissionLevel,
          permissionRules: defaultRulesForLevel(permissionLevel),
        })
      )
    },
    getSession(sessionId: string) {
      return input.persistence.sessionStore.getById(sessionId)
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
