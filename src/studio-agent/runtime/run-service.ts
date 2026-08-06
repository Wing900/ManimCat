import type { CustomApiConfig } from '../../types'
import type {
  StudioAssistantMessage,
  StudioEventBus,
  StudioRun,
  StudioSession,
  StudioToolChoice,
} from '../domain/types'
import type { StudioPersistence } from '../persistence/studio-persistence'
import {
  buildStudioContinueInputText,
  buildStudioContinuationRunMetadata,
  isStudioRunResumable,
  readStudioRunAutonomyMetadata,
} from '../runs/autonomy-policy'
import type { StudioModelPort } from '../model/studio-model-port'
import type { StudioBuilderRuntime } from './builder-runtime'
import { cancelRunState } from './execution/session-runner-helpers'

export interface StudioStartRunInput {
  ownerId: string
  projectId: string
  session: StudioSession
  inputText: string
  customApiConfig?: CustomApiConfig
  modelPort?: StudioModelPort
  toolChoice?: StudioToolChoice
}

export interface StudioContinueRunInput {
  ownerId: string
  projectId: string
  sourceRunId: string
  inputText?: string
  customApiConfig?: CustomApiConfig
  modelPort?: StudioModelPort
  toolChoice?: StudioToolChoice
}

export interface StudioStartedRun {
  run: StudioRun
  assistantMessage: StudioAssistantMessage
}

export interface StudioRunService {
  startRun: (input: StudioStartRunInput) => Promise<StudioStartedRun | null>
  continueRun: (input: StudioContinueRunInput) => Promise<{
    status: 'started'
    session: StudioSession
    run: StudioRun
    assistantMessage: StudioAssistantMessage
  } | {
    status: 'conflict' | 'not_found' | 'not_resumable'
    session?: StudioSession
    run?: StudioRun
  }>
  getRun: (ownerId: string, runId: string) => Promise<StudioRun | null>
  cancelRun: (input: { ownerId: string; runId: string; reason?: string }) => Promise<{
    status: 'cancelled' | 'already_finished' | 'not_found'
    run?: StudioRun
  }>
}

export function createStudioRunService(input: {
  persistence: StudioPersistence
  runtime: Pick<StudioBuilderRuntime, 'startBackgroundRun'>
  eventBus: StudioEventBus
}): StudioRunService {
  const activeSessionRuns = new Map<string, string>()
  const activeRunHandles = new Map<string, {
    sessionId: string
    handle: Awaited<ReturnType<StudioBuilderRuntime['startBackgroundRun']>>
  }>()

  async function startBackgroundRunLocked(runInput: StudioStartRunInput & { runMetadata?: Record<string, unknown> }): Promise<StudioStartedRun | null> {
    if (runInput.session.ownerId !== runInput.ownerId || activeSessionRuns.has(runInput.session.id)) {
      return null
    }

    const handle = await input.runtime.startBackgroundRun(runInput)
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
      assistantMessage: handle.assistantMessage,
    }
  }

  async function continueRun(runInput: StudioContinueRunInput) {
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
  }

  async function cancelRun(cancelInput: { ownerId: string; runId: string; reason?: string }) {
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
    ) ?? cancelRunState(run, reason)

    input.eventBus.publish({
      type: 'run_updated',
      sessionId: run.sessionId,
      run: cancelledRun
    })

    return { status: 'cancelled' as const, run: cancelledRun }
  }

  return {
    startRun: (runInput) => startBackgroundRunLocked(runInput),
    continueRun,
    getRun: (ownerId, runId) => input.persistence.runStore.getById(ownerId, runId),
    cancelRun,
  }
}
