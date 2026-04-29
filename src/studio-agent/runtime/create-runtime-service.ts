import fs from 'node:fs'
import { createStudioSession } from '../domain/factories'
import type {
  StudioEventBus,
  StudioKind,
  StudioPermissionLevel,
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
import { resolveStudioPermissionMode, type StudioPermissionMode } from '../session-control/permission-modes'
import { registerSharedStudioTools } from '../shared/register-shared-tools'
import {
  buildStudioContinueInputText,
  buildStudioContinuationRunMetadata,
  isStudioRunResumable,
  readStudioRunAutonomyMetadata,
} from '../runs/autonomy-policy'
import { createStudioSkillRuntime } from '../skills/runtime/skill-runtime'
import { createInMemoryActiveSkillStore } from '../skills/state/skill-state-store'
import type { StudioSkillDiscoveryEntry } from '../skills/schema/skill-types'
import type { StudioBlobStore } from '../storage/studio-blob-store'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import { createStudioDefaultTurnPlanResolver } from './planning/default-turn-plan-resolver'
import { syncStudioRenderTask } from './session/render-task-sync'
import { createStudioSessionMetadata } from './session/session-agent-config'
import { flushTerminalSessionEventsToAssistant } from './session/session-event-inbox'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import { cancelRunState } from './execution/session-runner-helpers'

interface SubscribableStudioEventBus extends StudioEventBus {
  subscribe: (listener: StudioEventListener) => () => void
}

interface CreateStudioRuntimeServiceInput {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  blobStore: StudioBlobStore
  registry?: StudioToolRegistry
  eventBus?: SubscribableStudioEventBus
}

export interface StudioRuntimeService {
  registry: StudioToolRegistry
  runtime: StudioBuilderRuntime
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
    permissionMode?: StudioPermissionMode
    workspaceId?: string
    toolChoice?: StudioToolChoice
  }) => Promise<StudioSession>
  getSession: (sessionId: string) => Promise<StudioSession | null>
  updateSession: (sessionId: string, patch: {
    permissionMode?: StudioPermissionMode
  }) => Promise<StudioSession | null>
  listSessionSkills: (sessionId: string) => Promise<StudioSkillDiscoveryEntry[] | null>
  startRun: (input: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: import('../../types').CustomApiConfig
    toolChoice?: StudioToolChoice
  }) => Promise<{ run: import('../domain/types').StudioRun; assistantMessage: import('../domain/types').StudioAssistantMessage } | null>
  continueRun: (input: {
    projectId: string
    sourceRunId: string
    inputText?: string
    customApiConfig?: import('../../types').CustomApiConfig
    toolChoice?: StudioToolChoice
  }) => Promise<{
    status: 'started'
    session: StudioSession
    run: import('../domain/types').StudioRun
    assistantMessage: import('../domain/types').StudioAssistantMessage
  } | {
    status: 'conflict' | 'not_found' | 'not_resumable'
    session?: StudioSession
    run?: import('../domain/types').StudioRun
  }>
  syncSession: (sessionId: string) => Promise<void>
  listWorkResultsBySessionId: (sessionId: string) => Promise<StudioWorkResult[]>
  listExternalEvents: () => StudioExternalEvent[]
  subscribeExternalEvents: (listener: (event: StudioExternalEvent) => void) => () => void
  cancelRun: (input: { runId: string; reason?: string }) => Promise<{
    status: 'cancelled' | 'already_finished' | 'not_found'
    run?: import('../domain/types').StudioRun
  }>
}

export function createStudioRuntimeService(input: CreateStudioRuntimeServiceInput): StudioRuntimeService {
  const registry = input.registry ?? new StudioToolRegistry()
  const eventBus: SubscribableStudioEventBus = input.eventBus ?? new InMemoryStudioEventBus()
  const externalEventLog: StudioExternalEvent[] = []
  const activeSessionRuns = new Map<string, string>()
  const activeRunHandles = new Map<string, {
    sessionId: string
    handle: Awaited<ReturnType<StudioBuilderRuntime['startBackgroundRun']>>
  }>()

  registerSharedStudioTools(registry)
  registerManimStudioTools(registry)
  registerPlotStudioTools(registry)

  const skillRuntime = createStudioSkillRuntime()
  const activeSkillStore = createInMemoryActiveSkillStore()
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
    resolveTurnPlan,
    resolveSkill: skillRuntime.resolve,
    listSkills: skillRuntime.listDiscovery,
    listSkillSummaries: skillRuntime.listSummaries,
    recordSkillUsage: skillRuntime.recordUsage,
    activeSkillStore,
    eventBus,
  })

  eventBus.subscribe((event) => {
    const adapted = adaptStudioEvent(event)
    if (adapted) {
      externalEventLog.push(adapted)
    }
  })

  async function startBackgroundRunLocked(runInput: {
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: import('../../types').CustomApiConfig
    toolChoice?: StudioToolChoice
    runMetadata?: Record<string, unknown>
  }) {
    if (activeSessionRuns.has(runInput.session.id)) {
      return null
    }

    const handle = await runtime.startBackgroundRun(runInput)
    activeSessionRuns.set(runInput.session.id, handle.run.id)
    activeRunHandles.set(handle.run.id, {
      sessionId: runInput.session.id,
      handle,
    })

    void handle.completion
      .catch(() => {
        // Run-specific failure is already logged by the session runner.
      })
      .finally(() => {
        if (activeSessionRuns.get(runInput.session.id) === handle.run.id) {
          activeSessionRuns.delete(runInput.session.id)
        }
        activeRunHandles.delete(handle.run.id)
      })

    return {
      run: handle.run,
      assistantMessage: handle.assistantMessage
    }
  }

  return {
    registry,
    runtime,
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
      const studioKind = sessionInput.studioKind ?? 'manim'
      const normalizedDirectory = input.workspaceProvider.normalizeDirectory(sessionInput.directory)
      const permissionMode = sessionInput.permissionMode ?? mapPermissionLevelToMode(sessionInput.permissionLevel) ?? 'auto'
      const resolvedPermissionMode = resolveStudioPermissionMode(
        permissionMode,
        createStudioSession({
          projectId: sessionInput.projectId,
          workspaceId: sessionInput.workspaceId,
          studioKind,
          agentType: sessionInput.agentType ?? 'builder',
          title: sessionInput.title ?? getDefaultSessionTitle(studioKind),
          directory: normalizedDirectory,
          permissionLevel: 'L3',
          permissionRules: [],
        }),
      )
      const session = createStudioSession({
        projectId: sessionInput.projectId,
        workspaceId: sessionInput.workspaceId,
        studioKind,
        agentType: sessionInput.agentType ?? 'builder',
        title: sessionInput.title ?? getDefaultSessionTitle(studioKind),
        directory: normalizedDirectory,
        permissionLevel: resolvedPermissionMode.permissionLevel,
        permissionRules: resolvedPermissionMode.permissionRules,
        metadata: createStudioSessionMetadata({
          existing: { studioKind },
          agentConfig: {
            toolChoice: sessionInput.toolChoice,
          },
          permissionMode: resolvedPermissionMode.mode,
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
    async listSessionSkills(sessionId) {
      const session = await input.persistence.sessionStore.getById(sessionId)
      if (!session) {
        return null
      }

      return skillRuntime.listDiscovery(session)
    },
    async startRun(runInput) {
      return startBackgroundRunLocked(runInput)
    },
    async continueRun(runInput) {
      const sourceRun = await input.persistence.runStore.getById(runInput.sourceRunId)
      if (!sourceRun) {
        return { status: 'not_found' as const }
      }

      const session = await input.persistence.sessionStore.getById(sourceRun.sessionId)
      if (!session) {
        return { status: 'not_found' as const, run: sourceRun }
      }

      if (!isStudioRunResumable(sourceRun)) {
        return { status: 'not_resumable' as const, session, run: sourceRun }
      }

      if (activeSessionRuns.has(session.id)) {
        return { status: 'conflict' as const, session, run: sourceRun }
      }

      const autonomy = readStudioRunAutonomyMetadata(sourceRun.metadata)
      const started = await startBackgroundRunLocked({
        projectId: runInput.projectId,
        session,
        inputText: runInput.inputText?.trim() || buildStudioContinueInputText(autonomy.stopReason),
        customApiConfig: runInput.customApiConfig,
        toolChoice: runInput.toolChoice,
        runMetadata: buildStudioContinuationRunMetadata({
          sourceRunId: sourceRun.id,
          sourceMetadata: sourceRun.metadata,
        }),
      })

      if (!started) {
        return { status: 'conflict' as const, session, run: sourceRun }
      }

      return {
        status: 'started' as const,
        session,
        run: started.run,
        assistantMessage: started.assistantMessage,
      }
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
    async cancelRun(cancelInput) {
      const run = await input.persistence.runStore.getById(cancelInput.runId)
      if (!run) {
        return { status: 'not_found' as const }
      }

      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return { status: 'already_finished' as const, run }
      }

      const reason = cancelInput.reason?.trim() || 'Run cancelled by user'
      activeRunHandles.get(cancelInput.runId)?.handle.abort(reason)

      const cancelledRun = await input.persistence.runStore.update(cancelInput.runId, cancelRunState(run, reason))
        ?? cancelRunState(run, reason)

      eventBus.publish({
        type: 'run_updated',
        run: cancelledRun
      })

      const [tasks, works] = await Promise.all([
        input.persistence.taskStore.listBySessionId(run.sessionId),
        input.persistence.workStore.listBySessionId(run.sessionId),
      ])

      await Promise.all(tasks
        .filter((task) => task.runId === cancelInput.runId)
        .filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'pending_confirmation' || task.status === 'proposed')
        .map(async (task) => {
          const updated = await input.persistence.taskStore.update(task.id, {
            status: 'cancelled',
            metadata: {
              ...(task.metadata ?? {}),
              cancelReason: reason,
            }
          }) ?? {
            ...task,
            status: 'cancelled' as const,
            metadata: {
              ...(task.metadata ?? {}),
              cancelReason: reason,
            }
          }

          eventBus.publish({
            type: 'task_updated',
            sessionId: updated.sessionId,
            runId: updated.runId,
            task: updated,
          })
        }))

      await Promise.all(works
        .filter((work) => work.runId === cancelInput.runId)
        .filter((work) => work.status === 'queued' || work.status === 'running' || work.status === 'proposed')
        .map(async (work) => {
          const updated = await input.persistence.workStore.update(work.id, {
            status: 'cancelled',
            metadata: {
              ...(work.metadata ?? {}),
              cancelReason: reason,
            }
          }) ?? {
            ...work,
            status: 'cancelled' as const,
            metadata: {
              ...(work.metadata ?? {}),
              cancelReason: reason,
            }
          }

          eventBus.publish({
            type: 'work_updated',
            sessionId: updated.sessionId,
            runId: updated.runId,
            work: updated,
          })
        }))

      return { status: 'cancelled' as const, run: cancelledRun }
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

function mapPermissionLevelToMode(level?: StudioPermissionLevel): StudioPermissionMode | undefined {
  switch (level) {
    case 'L0':
    case 'L1':
    case 'L2':
      return 'safe'
    case 'L3':
      return 'auto'
    case 'L4':
      return 'full'
    default:
      return undefined
  }
}
