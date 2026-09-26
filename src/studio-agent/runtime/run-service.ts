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
import { STUDIO_RUN_ACTIVE_STATUSES, isStudioRunTerminalStatus, STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE } from '../runs/run-status-transitions'
import type { StudioModelPort } from '../model/studio-model-port'
import type {
  StudioRunCoordinationServicePort
} from '../run-coordination/studio-run-coordination-service'
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

/**
 * Explicit admission outcome. `null` used to conflate "someone else owns this session" with
 * "the coordination layer could not answer", which HTTP could only report as one conflict.
 */
export type StudioStartRunResult =
  | { status: 'started'; run: StudioRun; assistantMessage: StudioAssistantMessage }
  | { status: 'conflict' }
  | { status: 'coordination_unavailable'; message: string }

export type StudioContinueRunResult =
  | {
      status: 'started'
      session: StudioSession
      run: StudioRun
      assistantMessage: StudioAssistantMessage
    }
  | {
      status: 'conflict' | 'not_found' | 'not_resumable'
      session?: StudioSession
      run?: StudioRun
    }
  | {
      status: 'coordination_unavailable'
      session?: StudioSession
      run?: StudioRun
      message: string
    }

export type StudioCancelRunResult =
  | { status: 'cancelled'; run: StudioRun }
  | { status: 'already_finished'; run: StudioRun }
  | { status: 'not_found' }
  | { status: 'coordination_unavailable'; message: string; run: StudioRun }

export interface StudioRunService {
  startRun: (input: StudioStartRunInput) => Promise<StudioStartRunResult>
  continueRun: (input: StudioContinueRunInput) => Promise<StudioContinueRunResult>
  getRun: (ownerId: string, runId: string) => Promise<StudioRun | null>
  cancelRun: (input: { ownerId: string; runId: string; reason?: string }) => Promise<StudioCancelRunResult>
}

export interface CreateStudioRunServiceInput {
  persistence: StudioPersistence
  runtime: Pick<StudioBuilderRuntime, 'startBackgroundRun'>
  eventBus: StudioEventBus
  coordination: StudioRunCoordinationServicePort
}

export function createStudioRunService(input: CreateStudioRunServiceInput): StudioRunService {
  const { coordination } = input

  async function startAdmittedRun(
    runInput: StudioStartRunInput & { runMetadata?: Record<string, unknown> }
  ): Promise<StudioStartRunResult> {
    if (runInput.session.ownerId !== runInput.ownerId) {
      return { status: 'conflict' }
    }

    // Lease first: admission is decided before any Run is persisted, so two replicas cannot
    // each create a Run for the same session.
    const admission = await coordination.reserveSession({
      ownerId: runInput.ownerId,
      sessionId: runInput.session.id
    })
    if (admission.status === 'conflict') {
      return { status: 'conflict' }
    }
    if (admission.status === 'coordination_unavailable') {
      return { status: 'coordination_unavailable', message: admission.message }
    }
    const reservation = admission.reservation

    let handle: Awaited<ReturnType<StudioBuilderRuntime['startBackgroundRun']>>
    try {
      handle = await input.runtime.startBackgroundRun(runInput)
    } catch (error) {
      // The Run never came up: give the lease back instead of holding the session hostage.
      await coordination.finishRun({ reservation })
      throw error
    }

    // Attachment registers the local handle and recovers a cancellation that arrived before
    // this point; the coordination service issues the abort itself when that happens.
    await coordination.attachRun({ reservation, runId: handle.run.id, abort: handle.abort })

    void handle.completion
      .catch(() => {
        // Run-specific failure is already logged by the session runner.
      })
      .finally(() => {
        void coordination.finishRun({ reservation, runId: handle.run.id }).catch(() => {
          // Release failures are logged by the coordination service; lease TTL is the fallback.
        })
      })

    return {
      status: 'started',
      run: handle.run,
      assistantMessage: handle.assistantMessage
    }
  }

  async function continueRun(runInput: StudioContinueRunInput): Promise<StudioContinueRunResult> {
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

    const autonomy = readStudioRunAutonomyMetadata(sourceRun.metadata)
    const started = await startAdmittedRun({
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

    if (started.status === 'conflict') {
      return { status: 'conflict' as const, session, run: sourceRun }
    }
    if (started.status === 'coordination_unavailable') {
      return {
        status: 'coordination_unavailable' as const,
        session,
        run: sourceRun,
        message: started.message
      }
    }

    return {
      status: 'started' as const,
      session,
      run: started.run,
      assistantMessage: started.assistantMessage,
    }
  }

  async function cancelRun(cancelInput: {
    ownerId: string
    runId: string
    reason?: string
  }): Promise<StudioCancelRunResult> {
    const run = await input.persistence.runStore.getById(cancelInput.ownerId, cancelInput.runId)
    if (!run) {
      return { status: 'not_found' as const }
    }

    if (isStudioRunTerminalStatus(run.status)) {
      return { status: 'already_finished' as const, run }
    }

    // Signal before persisting: the owning replica stops generating even when this replica is
    // the one that writes the terminal transition.
    const cancellation = await coordination.requestCancellation({
      runId: cancelInput.runId,
      reason: cancelInput.reason
    })
    if (cancellation.status === 'coordination_unavailable') {
      return { status: 'coordination_unavailable' as const, message: cancellation.message, run }
    }

    const reason = cancellation.command.reason
    const transitioned = await input.persistence.runStore.transitionStatus({
      ownerId: cancelInput.ownerId,
      runId: cancelInput.runId,
      from: STUDIO_RUN_ACTIVE_STATUSES,
      patch: cancelRunState(run, reason)
    })
    if (!transitioned.run) {
      // Persistence could not identify any Run for this write, so nothing was stored: neither a
      // cancellation nor a terminal state may be claimed, and no `run_updated` may be published.
      return {
        status: 'coordination_unavailable' as const,
        message: STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE,
        run
      }
    }
    const cancelledRun = transitioned.run
    input.eventBus.publish({
      type: 'run_updated',
      sessionId: run.sessionId,
      run: cancelledRun
    })

    if (!transitioned.applied) {
      // A completion or failure already won the race: report the persisted winner.
      return { status: 'already_finished' as const, run: cancelledRun }
    }

    return { status: 'cancelled' as const, run: cancelledRun }
  }

  return {
    startRun: (runInput) => startAdmittedRun(runInput),
    continueRun,
    getRun: (ownerId, runId) => input.persistence.runStore.getById(ownerId, runId),
    cancelRun,
  }
}
