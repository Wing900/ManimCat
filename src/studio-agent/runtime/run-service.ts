import { materializeStudioSceneSources } from '../scenes/materialize-studio-scene-sources'
import type { CustomApiConfig } from '../../types'
import type {
  StudioAssistantMessage,
  StudioUserMessage,
  StudioEventBus,
  StudioRun,
  StudioSession,
  StudioToolChoice,
} from '../domain/types'
import type { StudioPersistence } from '../infrastructure/persistence/studio-persistence'
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
} from '../infrastructure/coordination/studio-run-coordination-service'
import {
  createLegacyStudioRunScope,
  createSceneStudioRunScope,
  type StudioRunCoordinationScope
} from '../infrastructure/coordination/studio-run-coordinator'
import type { StudioBuilderRuntime } from './builder-runtime'
import { cancelRunState } from './execution/session-runner-helpers'
import { cancelStudioRunRenders } from '../render/cancel-run-renders'
import type { StudioRenderDriverRegistry } from '../render/studio-render-driver'

export interface StudioStartRunInput {
  ownerId: string
  projectId: string
  session: StudioSession
  /**
   * Scene scope of the Run. Absent means the Legacy whole-Session Run, which excludes every
   * Scene of that Session; a supplied Scene must belong to `session` or admission fails.
   */
  sceneId?: string
  inputText: string
  /**
   * The Session's whole Scene source map, sent by the browser that owns the code. Materialized into
   * the workspace before the session runner loads its execution scope; absent leaves files alone.
   */
  sceneSources?: Record<string, string>
  customApiConfig?: CustomApiConfig
  /**
   * The CatKey paying for this Run, or undefined for BYOK.
   *
   * Carried so the checkpoint that persists `token_usage` can also write the CatKey ledger. The
   * id is not a credential: the Studio side never authenticates upstream, it only says who to bill.
   */
  catKeyId?: string
  modelPort?: StudioModelPort
  toolChoice?: StudioToolChoice
}

/**
 * Continue an existing Run. The continuation inherits the source Run's CatKey, because the work it
 * pays for belongs to the same browser that started it.
 */
export interface StudioContinueRunInput {
  ownerId: string
  projectId: string
  sourceRunId: string
  inputText?: string
  customApiConfig?: CustomApiConfig
  catKeyId?: string
  modelPort?: StudioModelPort
  toolChoice?: StudioToolChoice
}

/**
 * Explicit admission outcome. `null` used to conflate "someone else owns this session" with
 * "the coordination layer could not answer", which HTTP could only report as one conflict.
 */
export type StudioStartRunResult =
  | { status: 'started'; run: StudioRun; assistantMessage: StudioAssistantMessage; userMessage?: StudioUserMessage }
  | { status: 'conflict' }
  /** Unknown, foreign-owner or foreign-Session Scene: collapsed on purpose, never distinguished. */
  | { status: 'not_found' }
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
  driverRegistry: StudioRenderDriverRegistry
}

export function createStudioRunService(input: CreateStudioRunServiceInput): StudioRunService {
  const { coordination } = input
  // Local execution handle cleanup, keyed by Run. Registered before attachment so a cancellation
  // on this replica can wait for generation to drain and for the lease release to complete.
  const localCleanup = new Map<string, Promise<void>>()

  async function awaitLocalCleanup(runId: string): Promise<boolean> {
    const pending = localCleanup.get(runId)
    if (!pending) {
      // Remote Run: no local execution exists on this replica.
      return true
    }
    try {
      await pending
      return true
    } catch {
      return false
    }
  }

  async function startAdmittedRun(
    runInput: StudioStartRunInput & { runMetadata?: Record<string, unknown> }
  ): Promise<StudioStartRunResult> {
    if (runInput.session.ownerId !== runInput.ownerId) {
      return { status: 'conflict' }
    }

    // Scene validation first: nothing is reserved and nothing is persisted when the caller
    // names a Scene this Session does not own.
    let scope: StudioRunCoordinationScope = createLegacyStudioRunScope(runInput.session.id)
    if (runInput.sceneId) {
      const scene = await input.persistence.sceneStore.getById(runInput.ownerId, runInput.sceneId)
      if (!scene || scene.sessionId !== runInput.session.id) {
        return { status: 'not_found' }
      }
      scope = createSceneStudioRunScope(runInput.session.id, scene.id)
    }

    // Lease first: admission is decided before any Run is persisted, so two replicas cannot
    // each create a Run for the same scope, and a Scene Run can never start beside a Legacy Run.
    const admission = await coordination.reserveScope({
      ownerId: runInput.ownerId,
      scope
    })
    if (admission.status === 'conflict') {
      return { status: 'conflict' }
    }
    if (admission.status === 'coordination_unavailable') {
      return { status: 'coordination_unavailable', message: admission.message }
    }
    const reservation = admission.reservation

    // The workspace must match the request before the session runner reads it. Doing this after
    // admission means a rejected Run (conflict, unavailable coordination) never writes anything.
    if (runInput.sceneSources) {
      try {
        const scenes = await input.persistence.sceneStore.listBySessionId(runInput.ownerId, runInput.session.id)
        const sourceFilenames = Object.fromEntries(scenes.map((scene) => [
          scene.id,
          scene.sourcePath.replace(/\\/g, '/').split('/').at(-1)!,
        ]))
        for (const sceneId of Object.keys(runInput.sceneSources)) {
          if (!Object.hasOwn(sourceFilenames, sceneId)) {
            throw new Error('Scene source does not belong to the admitted Session')
          }
        }
        await materializeStudioSceneSources({
          rootDirectory: runInput.session.directory,
          sceneSources: runInput.sceneSources,
          sourceFilenames,
        })
      } catch (error) {
        // The Run never came up: give the lease back instead of holding the session hostage.
        await coordination.finishRun({ reservation })
        throw error
      }
    }

    let handle: Awaited<ReturnType<StudioBuilderRuntime['startBackgroundRun']>>
    try {
      handle = await input.runtime.startBackgroundRun(runInput)
    } catch (error) {
      // The Run never came up: give the lease back instead of holding the session hostage.
      await coordination.finishRun({ reservation })
      throw error
    }

    const runId = handle.run.id
    const cleanup = (async () => {
      try {
        await handle.completion
      } catch {
        // Run-specific failure is already logged by the session runner.
      }
      // Release only after execution has actually stopped. A failure here is reported to the
      // cancellation caller; lease TTL remains the fallback.
      await coordination.finishRun({ reservation, runId })
    })()
    localCleanup.set(runId, cleanup)
    // Observe rejection immediately; callers that wait for cleanup still see the failure.
    void cleanup.then(
      () => {
        if (localCleanup.get(runId) === cleanup) {
          localCleanup.delete(runId)
        }
      },
      () => {
        if (localCleanup.get(runId) === cleanup) {
          localCleanup.delete(runId)
        }
      }
    )

    // Attachment registers the local handle and recovers a cancellation that arrived before
    // this point; the coordination service issues the abort itself when that happens.
    await coordination.attachRun({ reservation, runId, abort: handle.abort })

    return {
      status: 'started',
      run: handle.run,
      userMessage: handle.userMessage,
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
      // A continuation can only inherit: the source Run's scope is copied verbatim, so callers
      // cannot switch Scene, and a Legacy continuation stays Legacy.
      sceneId: sourceRun.sceneId,
      inputText: runInput.inputText?.trim() || buildStudioContinueInputText(autonomy.stopReason),
      customApiConfig: runInput.customApiConfig,
      catKeyId: runInput.catKeyId,
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
    if (started.status === 'not_found') {
      // The inherited Scene no longer resolves: a continuation must never silently widen back to
      // the whole Session, so this is a not-found outcome like any other unresolvable source.
      return { status: 'not_found' as const, run: sourceRun }
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
      // Model generation can be finished while its video is still queued or rendering.
      try {
        await cancelStudioRunRenders({ run, renderStore: input.persistence.renderStore,
          eventBus: input.eventBus, driverRegistry: input.driverRegistry })
      } catch {
        return { status: 'coordination_unavailable', message: 'Unable to cancel render tasks; please retry.', run }
      }
      // A terminal Run may still be draining locally: let its lease release finish before a
      // resend is allowed to contend for the same scope.
      if (!(await awaitLocalCleanup(cancelInput.runId))) {
        return {
          status: 'coordination_unavailable' as const,
          message: STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE,
          run
        }
      }
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
    try {
      await cancelStudioRunRenders({ run, renderStore: input.persistence.renderStore,
        eventBus: input.eventBus, driverRegistry: input.driverRegistry })
    } catch {
      return { status: 'coordination_unavailable', message: 'Unable to cancel render tasks; please retry.', run }
    }
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
    // Cancel is acknowledged only once local execution has drained and the lease cleanup ran;
    // otherwise an immediate resend on this replica races the still-held lease.
    if (!(await awaitLocalCleanup(cancelInput.runId))) {
      return {
        status: 'coordination_unavailable' as const,
        message: STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE,
        run: cancelledRun
      }
    }
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
