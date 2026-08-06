import fs from 'node:fs'
import { createStudioSession } from '../domain/factories'
import type {
  StudioEventBus,
  StudioKind,
  StudioSession,
  StudioSessionSnapshot,
  StudioSessionWorkSnapshot,
  StudioTask,
  StudioToolChoice,
  StudioWork,
  StudioWorkResult,
} from '../domain/types'
import { InMemoryStudioEventBus } from '../events/event-bus'
import { adaptStudioEvent, type StudioExternalEvent } from '../events/studio-event-adapter'
import { registerManimStudioTools } from '../manim/register-manim-tools'
import {
  createUnconfiguredManimRenderPort,
  type ManimRenderPort,
} from '../manim/manim-render-port'
import type { StudioPersistence } from '../persistence/studio-persistence'
import { registerPlotStudioTools } from '../plot/register-plot-tools'
import {
  createUnconfiguredPlotRenderPort,
  type PlotRenderPort,
} from '../plot/plot-render-port'
import {
  createEmptyStudioRenderJobPort,
  type StudioRenderJobPort,
} from '../render/render-job-port'
import { registerSharedStudioTools } from '../shared/register-shared-tools'
import {
  buildStudioContinueInputText,
  buildStudioContinuationRunMetadata,
  isStudioRunResumable,
  readStudioRunAutonomyMetadata,
} from '../runs/autonomy-policy'
import type { StudioBlobStore } from '../storage/studio-blob-store'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import { syncStudioRenderTask } from './session/render-task-sync'
import { createStudioSessionMetadata } from './session/session-agent-config'
import { flushTerminalSessionEventsToAssistant } from './session/session-event-inbox'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import { getDefaultStudioWorkspacePath } from '../workspace/default-studio-workspace'
import { cancelRunState } from './execution/session-runner-helpers'

interface CreateStudioRuntimeServiceInput {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  blobStore: StudioBlobStore
  registry?: StudioToolRegistry
  eventBus?: StudioEventBus
  manimRenderPort?: ManimRenderPort
  plotRenderPort?: PlotRenderPort
  renderJobPort?: StudioRenderJobPort
}

export interface StudioRuntimeService {
  createSession: (sessionInput: {
    ownerId: string
    projectId: string
    directory?: string
    useDedicatedWorkspace?: boolean
    title?: string
    studioKind?: StudioKind
    agentType?: StudioSession['agentType']
    workspaceId?: string
    toolChoice?: StudioToolChoice
  }) => Promise<StudioSession>
  getSession: (ownerId: string, sessionId: string) => Promise<StudioSession | null>
  startRun: (input: {
    ownerId: string
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: import('../../types').CustomApiConfig
    toolChoice?: StudioToolChoice
  }) => Promise<{ run: import('../domain/types').StudioRun; assistantMessage: import('../domain/types').StudioAssistantMessage } | null>
  continueRun: (input: {
    ownerId: string
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
  getRun: (ownerId: string, runId: string) => Promise<import('../domain/types').StudioRun | null>
  getSessionSnapshot: (ownerId: string, sessionId: string) => Promise<StudioSessionSnapshot | null>
  getSessionTasks: (ownerId: string, sessionId: string) => Promise<StudioTask[] | null>
  getSessionWorkSnapshot: (ownerId: string, sessionId: string) => Promise<StudioSessionWorkSnapshot | null>
  subscribeExternalEvents: (sessionId: string, listener: (event: StudioExternalEvent) => void) => () => void
  cancelRun: (input: { ownerId: string; runId: string; reason?: string }) => Promise<{
    status: 'cancelled' | 'already_finished' | 'not_found'
    run?: import('../domain/types').StudioRun
  }>
}

export function createStudioRuntimeService(input: CreateStudioRuntimeServiceInput): StudioRuntimeService {
  const registry = input.registry ?? new StudioToolRegistry()
  const eventBus: StudioEventBus = input.eventBus ?? new InMemoryStudioEventBus()
  const renderJobPort = input.renderJobPort ?? createEmptyStudioRenderJobPort()
  const activeSessionRuns = new Map<string, string>()
  const activeRunHandles = new Map<string, {
    sessionId: string
    handle: Awaited<ReturnType<StudioBuilderRuntime['startBackgroundRun']>>
  }>()

  registerSharedStudioTools(registry)
  registerManimStudioTools(registry, input.manimRenderPort ?? createUnconfiguredManimRenderPort())
  registerPlotStudioTools(registry, input.plotRenderPort ?? createUnconfiguredPlotRenderPort())


  const runtime = new StudioBuilderRuntime({
    registry,
    messageStore: input.persistence.messageStore,
    partStore: input.persistence.partStore,
    runStore: input.persistence.runStore,
    sessionStore: input.persistence.sessionStore,
    taskStore: input.persistence.taskStore,
    workStore: input.persistence.workStore,
    workResultStore: input.persistence.workResultStore,
    renderStore: input.persistence.renderStore,
    sessionEventStore: input.persistence.sessionEventStore,
    eventBus,
  })

  async function startBackgroundRunLocked(runInput: {
    ownerId: string
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: import('../../types').CustomApiConfig
    toolChoice?: StudioToolChoice
    runMetadata?: Record<string, unknown>
  }) {
    if (runInput.session.ownerId !== runInput.ownerId) {
      return null
    }
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

  async function syncSessionState(ownerId: string, sessionId: string): Promise<void> {
    const tasks = await input.persistence.taskStore.listBySessionId(sessionId)
    for (const task of tasks) {
      await syncTaskState({
        ownerId,
        task,
        persistence: input.persistence,
        eventBus,
        renderJobPort,
        blobStore: input.blobStore,
      })
    }

    await flushTerminalSessionEventsToAssistant({
      sessionId,
      sessionEventStore: input.persistence.sessionEventStore,
      messageStore: input.persistence.messageStore,
      partStore: input.persistence.partStore,
    })
  }

  async function listWorkResults(sessionId: string): Promise<StudioWorkResult[]> {
    const works = await input.persistence.workStore.listBySessionId(sessionId)
    return collectWorkResults(works, input.persistence)
  }

  async function getSessionSnapshot(ownerId: string, sessionId: string): Promise<StudioSessionSnapshot | null> {
    const session = await input.persistence.sessionStore.getById(ownerId, sessionId)
    if (!session) {
      return null
    }

    await syncSessionState(ownerId, session.id)

    const [messages, runs, renders, sessionEvents, tasks, works, workResults] = await Promise.all([
      input.persistence.messageStore.listBySessionId(session.id),
      input.persistence.runStore.listBySessionId(ownerId, session.id),
      input.persistence.renderStore.listBySessionId(ownerId, session.id),
      input.persistence.sessionEventStore.listBySessionId(session.id),
      input.persistence.taskStore.listBySessionId(session.id),
      input.persistence.workStore.listBySessionId(session.id),
      listWorkResults(session.id),
    ])

    return { session, messages, runs, renders, sessionEvents, tasks, works, workResults }
  }

  async function getSessionTasks(ownerId: string, sessionId: string): Promise<StudioTask[] | null> {
    const session = await input.persistence.sessionStore.getById(ownerId, sessionId)
    if (!session) {
      return null
    }

    await syncSessionState(ownerId, session.id)
    return input.persistence.taskStore.listBySessionId(session.id)
  }

  async function getSessionWorkSnapshot(ownerId: string, sessionId: string): Promise<StudioSessionWorkSnapshot | null> {
    const session = await input.persistence.sessionStore.getById(ownerId, sessionId)
    if (!session) {
      return null
    }

    await syncSessionState(ownerId, session.id)
    const [sessionEvents, works, workResults] = await Promise.all([
      input.persistence.sessionEventStore.listBySessionId(session.id),
      input.persistence.workStore.listBySessionId(session.id),
      listWorkResults(session.id),
    ])

    return { sessionId: session.id, sessionEvents, works, workResults }
  }

  return {
    async createSession(sessionInput) {
      const studioKind = sessionInput.studioKind ?? 'manim'
      const normalizedDirectory = input.workspaceProvider.normalizeDirectory(
        sessionInput.directory ?? getDefaultStudioWorkspacePath()
      )
      const session = createStudioSession({
        ownerId: sessionInput.ownerId,
        projectId: sessionInput.projectId,
        workspaceId: sessionInput.workspaceId,
        studioKind,
        agentType: sessionInput.agentType ?? 'builder',
        title: sessionInput.title ?? getDefaultSessionTitle(studioKind),
        directory: normalizedDirectory,
        permissionLevel: 'L4',
        permissionRules: [],
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
    getSession(ownerId: string, sessionId: string) {
      return input.persistence.sessionStore.getById(ownerId, sessionId)
    },
    getRun(ownerId: string, runId: string) {
      return input.persistence.runStore.getById(ownerId, runId)
    },
    getSessionSnapshot,
    getSessionTasks,
    getSessionWorkSnapshot,
    async startRun(runInput) {
      return startBackgroundRunLocked(runInput)
    },
    async continueRun(runInput) {
      const sourceRun = await input.persistence.runStore.getById(runInput.ownerId, runInput.sourceRunId)
      if (!sourceRun) {
        return { status: 'not_found' as const }
      }

      const session = await input.persistence.sessionStore.getById(runInput.ownerId, sourceRun.sessionId)
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
        ownerId: runInput.ownerId,
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
    subscribeExternalEvents(sessionId: string, listener: (event: StudioExternalEvent) => void): () => void {
      return eventBus.subscribe(sessionId, (event) => {
        const adapted = adaptStudioEvent(event)
        if (adapted) {
          listener(adapted)
        }
      })
    },
    async cancelRun(cancelInput) {
      const run = await input.persistence.runStore.getById(cancelInput.ownerId, cancelInput.runId)
      if (!run) {
        return { status: 'not_found' as const }
      }

      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return { status: 'already_finished' as const, run }
      }

      const reason = cancelInput.reason?.trim() || 'Run cancelled by user'
      activeRunHandles.get(cancelInput.runId)?.handle.abort(reason)

      const cancelledRun = await input.persistence.runStore.update(
        cancelInput.ownerId,
        cancelInput.runId,
        cancelRunState(run, reason)
      )
        ?? cancelRunState(run, reason)

      eventBus.publish({
        type: 'run_updated',
        sessionId: run.sessionId,
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
  ownerId: string
  task: StudioTask
  persistence: StudioPersistence
  eventBus: StudioEventBus
  renderJobPort: StudioRenderJobPort
  blobStore: StudioBlobStore
}): Promise<void> {
  if (input.task.type !== 'render') {
    return
  }

  await syncStudioRenderTask({
    ownerId: input.ownerId,
    task: input.task,
    taskStore: input.persistence.taskStore,
    workStore: input.persistence.workStore,
    workResultStore: input.persistence.workResultStore,
    sessionStore: input.persistence.sessionStore,
    sessionEventStore: input.persistence.sessionEventStore,
    messageStore: input.persistence.messageStore,
    partStore: input.persistence.partStore,
    eventBus: input.eventBus,
    renderJobPort: input.renderJobPort,
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
