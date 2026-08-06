import fs from 'node:fs'
import { createStudioSession } from '../domain/factories'
import type {
  StudioEventBus,
  StudioKind,
  StudioSession,
  StudioSessionSnapshot,
  StudioToolChoice,
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
import { registerSharedStudioTools } from '../shared/register-shared-tools'
import {
  buildStudioContinueInputText,
  buildStudioContinuationRunMetadata,
  isStudioRunResumable,
  readStudioRunAutonomyMetadata,
} from '../runs/autonomy-policy'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import { createStudioSessionMetadata } from './session-config'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import type { StudioModelPort } from '../model/studio-model-port'
import type { StudioDocumentationContextProvider } from '../documentation/studio-documentation-context'
import { getDefaultStudioWorkspacePath } from '../workspace/default-studio-workspace'
import { cancelRunState } from './execution/session-runner-helpers'

interface CreateStudioRuntimeServiceInput {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  registry?: StudioToolRegistry
  eventBus?: StudioEventBus
  manimRenderPort?: ManimRenderPort
  plotRenderPort?: PlotRenderPort
  documentationProvider?: StudioDocumentationContextProvider
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
    modelPort?: StudioModelPort
    toolChoice?: StudioToolChoice
  }) => Promise<{ run: import('../domain/types').StudioRun; assistantMessage: import('../domain/types').StudioAssistantMessage } | null>
  continueRun: (input: {
    ownerId: string
    projectId: string
    sourceRunId: string
    inputText?: string
    customApiConfig?: import('../../types').CustomApiConfig
    modelPort?: StudioModelPort
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
  subscribeExternalEvents: (sessionId: string, listener: (event: StudioExternalEvent) => void) => () => void
  cancelRun: (input: { ownerId: string; runId: string; reason?: string }) => Promise<{
    status: 'cancelled' | 'already_finished' | 'not_found'
    run?: import('../domain/types').StudioRun
  }>
}

export function createStudioRuntimeService(input: CreateStudioRuntimeServiceInput): StudioRuntimeService {
  const registry = input.registry ?? new StudioToolRegistry()
  const eventBus: StudioEventBus = input.eventBus ?? new InMemoryStudioEventBus()
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
    renderStore: input.persistence.renderStore,
    documentationProvider: input.documentationProvider,
    eventBus,
  })

  async function startBackgroundRunLocked(runInput: {
    ownerId: string
    projectId: string
    session: StudioSession
    inputText: string
    customApiConfig?: import('../../types').CustomApiConfig
    modelPort?: StudioModelPort
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

  async function getSessionSnapshot(ownerId: string, sessionId: string): Promise<StudioSessionSnapshot | null> {
    const session = await input.persistence.sessionStore.getById(ownerId, sessionId)
    if (!session) {
      return null
    }

    const [messages, runs, renders] = await Promise.all([
      input.persistence.messageStore.listBySessionId(session.id),
      input.persistence.runStore.listBySessionId(ownerId, session.id),
      input.persistence.renderStore.listBySessionId(ownerId, session.id),
    ])

    return { session, messages, runs, renders }
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
        modelPort: runInput.modelPort,
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

      return { status: 'cancelled' as const, run: cancelledRun }
    },
  }
}

function getDefaultSessionTitle(studioKind: StudioKind): string {
  return studioKind === 'plot' ? 'Plot Studio Session' : 'Manim Studio Session'
}
