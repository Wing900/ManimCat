import type {
  StudioCreateSceneRunInput,
  StudioScene,
  StudioSceneRun,
  StudioRunStatus,
  StudioSceneSnapshot,
  StudioSessionSnapshot,
  StudioCreateSceneRunResponse,
} from '../protocol/studio-agent-types'
import type { StudioEventSubscriptionOptions } from '../api/studio-agent-events'
import type { StudioRequestOptions } from '../api/studio-agent-api'
import {
  cancelStudioRun,
  createStudioScene,
  createStudioSceneRun,
  getStudioSceneSnapshot,
  getStudioSessionSnapshot,
  reorderStudioScenes,
} from '../api/studio-agent-api'
import { subscribeStudioEvents } from '../api/studio-agent-events'
import { resolveStudioProviderConfig } from '../api/studio-provider-config'
import type { CustomApiConfig } from '../../types/api'
import { readStudioCinemaRequestError, STALE_RESULT, type StudioCinemaSnapshotOutcome } from './request-error'
import { SceneSnapshotReader } from './snapshot-reader'
import { RecoveryWindowSlot, takeBufferedRecoveryEvents } from './recovery-window'
import { MutationLane } from './mutation-lane'
import { RenderRefreshScheduler } from './render-refresh'
import { SceneStream } from './scene-stream'
import { InitializationWorkflow, type StudioCinemaAppendSceneOutcome } from './initialization-workflow'
import { selectSceneState } from './scene-state'
import { studioCinemaReducer, type StudioCinemaAction } from './scene-reducer'
import {
  readStudioCinemaActiveRun,
  readStudioCinemaSceneEligibility,
  type StudioCinemaSubmitBlockReason,
} from './scene-selectors'
import {
  buildStudioCinemaSceneKey,
  createInitialStudioCinemaState,
  isStudioCinemaTerminalRenderStatus,
  isStudioCinemaTerminalRunStatus,
  isStudioCinemaTextDeltaEvent,
  type StudioCinemaFeedbackCode,
  type StudioCinemaSceneEvent,
  type StudioCinemaSceneIdentity,
  type StudioCinemaSceneState,
  type StudioCinemaState,
} from './types'

/**
 * Cinema Scene controller.
 *
 * One instance owns one Session: the ordered Scene index, one state record per `(sessionId,
 * sceneId)`, the selected Scene stream and the single Scene mutation lane. It is the only place
 * with network side effects, and every dependency (API, Provider resolution, event source, clock,
 * abort factories) is injected, so the lifecycle can be driven without a socket, a real timer or a
 * server.
 *
 * Guarantees this file is responsible for:
 * - the binding is reentrant: `detach` (an effect cleanup) aborts the stream, drops queued work and
 *   invalidates every in-flight response while keeping the instance reusable, and only `dispose` is
 *   terminal — so a StrictMode setup replay reuses the same live controller;
 * - every awaited result is checked against the generation and the Session it started in, and every
 *   Session level state change carries its generation into the reducer, so a Session switch or an
 *   unmount can never write into the new Session;
 * - Scene creation and the index read share one Session mutation lane, the read is joined instead of
 *   duplicated, and the lane counts what is queued, so a late index read cannot clobber a Scene the
 *   lane just created and a finishing task cannot mark another queued task idle;
 * - recovery is connect-then-snapshot: no authoritative read happens before the stream reported a
 *   real connection, a reconnection starts a fresh window, the newest read of a Scene wins, and the
 *   protocol has no event cursor, so a window that cannot be proven complete is reported as a
 *   pending convergence instead of as an exactly-once delivery;
 * - a connection problem never rewrites a Run or Render outcome.
 */

import {
  isStudioCinemaAcceptedRunResponseForIdentity,
  readStudioCinemaCancelRunVerdict,
  isStudioCinemaSceneRunForIdentity,
} from './scene-response-identity'

/** Result of an explicit index read; `failed` is a definite answer, `stale` means nobody should act. */
export type StudioCinemaIndexOutcome = 'ok' | 'failed' | 'stale'

export interface StudioCinemaApiPort {
  createScene: (sessionId: string, options?: StudioRequestOptions) => Promise<StudioScene>
  reorderScenes: (sessionId: string, sceneIds: string[]) => Promise<StudioScene[]>
  getSceneSnapshot: (
    sessionId: string,
    sceneId: string,
    options?: StudioRequestOptions,
  ) => Promise<StudioSceneSnapshot>
  getSessionSnapshot: (sessionId: string, options?: StudioRequestOptions) => Promise<StudioSessionSnapshot>
  createSceneRun: (
    sessionId: string,
    sceneId: string,
    input: StudioCreateSceneRunInput,
    options?: StudioRequestOptions,
  ) => Promise<StudioCreateSceneRunResponse>
  cancelRun: (runId: string) => Promise<StudioCinemaCancelResponse>
}

/** Cancel answer, already narrowed: only the public status fields the Scene store may keep. */
export interface StudioCinemaCancelResponse {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  run?: unknown
}

export interface StudioCinemaProviderPort {
  resolve: () => {
    customApiConfig?: CustomApiConfig
    hasIncompleteProvider: boolean
  }
}

export interface StudioCinemaEventSourcePort {
  subscribe: (options: StudioEventSubscriptionOptions) => Promise<void>
}

export interface StudioCinemaControllerDependencies {
  api: StudioCinemaApiPort
  provider: StudioCinemaProviderPort
  events: StudioCinemaEventSourcePort
  clock: { now: () => number }
  createAbortController: () => AbortController
  /** Workflow identity for the one initialization workflow of a Session. */
  createWorkflowId: () => string
  /**
   * Single-shot delay primitive for the bounded render refresh loop. Injectable so a spec drives it
   * by hand: no test ever sleeps and no production module owns a global timer registry here.
   */
  scheduler: StudioCinemaScheduler
}

/** Runs `task` once after `delayMs`; the returned function cancels it while it is still pending. */
export interface StudioCinemaScheduler {
  schedule: (delayMs: number, task: () => void) => () => void
}

export type StudioCinemaInitializationOutcome =
  | { status: 'ready'; createdCount: number }
  | { status: 'partial'; createdCount: number; code: StudioCinemaFeedbackCode }
  | { status: 'failed'; createdCount: number; code: StudioCinemaFeedbackCode }
  | { status: 'already_ready'; createdCount: number }
  | { status: 'stale' }

export type StudioCinemaSubmitOutcome =
  | { status: 'accepted'; runId: string }
  | { status: 'failed'; code: StudioCinemaFeedbackCode }
  | { status: 'unknown'; code: StudioCinemaFeedbackCode }
  | { status: 'ignored_busy' }
  | { status: 'ignored_empty' }
  | { status: 'ignored_not_ready'; reason: StudioCinemaSubmitBlockReason }
  | { status: 'provider_incomplete' }
  | { status: 'provider_unavailable' }
  | { status: 'no_session' }
  | { status: 'stale' }

export type StudioCinemaCancelOutcome =
  | { status: 'requested' }
  | { status: 'failed'; code: StudioCinemaFeedbackCode }
  | { status: 'ignored_busy' }
  | { status: 'no_active_run' }
  | { status: 'no_session' }
  | { status: 'stale' }

export class StudioCinemaController {
  private readonly deps: StudioCinemaControllerDependencies
  private readonly listeners = new Set<() => void>()
  private state: StudioCinemaState = createInitialStudioCinemaState()
  private generation = 0
  private sceneStream: SceneStream
  private recoverySlot = new RecoveryWindowSlot()
  private lane = new MutationLane((pending) => this.publishMutationPending(pending))
  private readonly convergenceReads = new Set<string>()
  /**
   * The authoritative Scene snapshot reader. Owns the snapshot revision counter and the per-Scene
   * read de-duplication; the controller supplies the session context, the dispatch and the render
   * refresh scheduling through the reader's host interface.
   */
  private snapshotReader: SceneSnapshotReader
  /**
   * The render refresh loop of the selected Scene. The scheduler owns the cycle, the token and the
   * budget; this controller supplies the snapshot read and the session context through the host
   * interface.
   */
  private renderRefresh: RenderRefreshScheduler
  /**
   * The one initialization workflow of a Session: fills a fresh Session to the default Scene count,
   * sequentially, through the mutation lane; a repeated call joins the running workflow. Owns the
   * workflow slot, the workflow counter and the in-flight index read.
   */
  private initWorkflow: InitializationWorkflow
  /**
   * Assistant deltas applied outside a recovery window, per Scene. A read compares this counter with
   * the value it started from: text that arrived while the read was in flight is not covered by the
   * snapshot it returns, because the snapshot replaces the message list.
   */
  private readonly appliedLiveTextDeltas = new Map<string, number>()
  private sessionAbort = new AbortController()
  private disposed = false
  private attached = true

  constructor(deps: StudioCinemaControllerDependencies) {
    this.deps = deps
    this.renderRefresh = new RenderRefreshScheduler(
      {
        isInactive: () => this.isInactive(),
        isCycleCurrent: (cycle) =>
          !this.disposed &&
          !this.isStaleGeneration(cycle.generation) &&
          this.state.session.id === cycle.identity.sessionId &&
          this.state.selectedSceneId === cycle.identity.sceneId,
        selectedScene: () => {
          const sceneId = this.state.selectedSceneId
          if (!sceneId) {
            return null
          }
          const identity = this.resolveIdentity(sceneId)
          if (!identity) {
            return null
          }
          const scene = selectSceneState(this.state, identity)
          return scene ? { identity, scene, generation: this.generation } : null
        },
        sceneState: (identity) => selectSceneState(this.state, identity),
        dispatch: (action) => this.dispatch(action),
        requestSceneSnapshot: (identity, kind) => this.snapshotReader.requestSceneSnapshot(identity, kind),
      },
      deps.scheduler,
    )
    this.sceneStream = new SceneStream(
      {
        isStaleGeneration: (generation) => this.isStaleGeneration(generation),
        isStreamActive: (identity) => !this.disposed && this.state.session.id === identity.sessionId,
        generation: () => this.generation,
        dispatch: (action) => this.dispatch(action),
        onSceneRecordEvent: (identity, event) => this.handleSceneRecordEvent(identity, event),
        onConnectionReady: (identity, generation, subscriptionId, epoch) =>
          void this.recoverScene(identity, generation, subscriptionId, epoch),
        renderRefreshEnd: () => this.renderRefresh.end(),
      },
      this.recoverySlot,
      deps.events,
      deps.createAbortController,
    )
    this.snapshotReader = new SceneSnapshotReader(
      {
        isInactive: () => this.isInactive(),
        generation: () => this.generation,
        sessionId: () => this.state.session.id,
        dispatch: (action) => this.dispatch(action),
        renderRefreshSchedule: () => this.renderRefresh.schedule(),
        sessionSignal: () => this.sessionSignal(),
        getSceneSnapshot: (sessionId, sceneId, options) =>
          this.deps.api.getSceneSnapshot(sessionId, sceneId, options),
      },
      this.sceneStream,
      this.recoverySlot,
    )
    this.initWorkflow = new InitializationWorkflow({
      state: () => this.state,
      generation: () => this.generation,
      isStaleGeneration: (generation) => this.isStaleGeneration(generation),
      isInactive: () => this.isInactive(),
      dispatch: (action) => this.dispatch(action),
      laneRun: (task) => this.lane.run(task),
      api: () => this.deps.api,
      createWorkflowId: () => this.deps.createWorkflowId(),
      sessionSignal: () => this.sessionSignal(),
      sceneStreamHasActive: () => this.sceneStream.peek() !== null,
      sceneStreamStop: () => this.sceneStream.stop(),
      selectScene: (sceneId) => this.selectScene(sceneId),
    })
  }

  getState(): StudioCinemaState {
    return this.state
  }

  /** True after `dispose`; terminal. A detached controller stays reusable. */
  isDisposed(): boolean {
    return this.disposed
  }

  /** True while the binding holds this controller (between an effect setup and its cleanup). */
  isAttached(): boolean {
    return this.attached && !this.disposed
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Effect setup: re-arm a controller that an earlier cleanup detached. Idempotent, so a StrictMode
   * setup replay needs no new instance.
   */
  attach(): void {
    if (this.disposed) {
      return
    }
    this.attached = true
    this.resetSessionRequests()
  }

  /**
   * Effect cleanup: stop all network work of this binding while keeping the instance reusable. The
   * generation bump invalidates every in-flight response, and the pending requests are aborted
   * instead of merely ignored, so nothing keeps running for a Session nobody is watching.
   */
  detach(): void {
    this.attached = false
    this.generation += 1
    this.abortSessionRequests()
    this.sceneStream.stop()
    this.initWorkflow.clear()
  }

  /** Terminal teardown: detach and drop every listener. Nothing may write afterwards. */
  dispose(): void {
    this.disposed = true
    this.detach()
    this.listeners.clear()
  }

  /** Opens a Session without touching the server: recovery never creates a Scene. */
  openSession(input: { sessionId: string; title?: string | null; projectId?: string | null }): void {
    if (this.isInactive()) {
      return
    }

    const sameSession = this.state.session.id === input.sessionId
    this.generation += 1
    this.sceneStream.stop()
    this.resetSessionRequests()
    if (!sameSession) {
      this.initWorkflow.clear()
      this.snapshotReader.clearRevisions()
      this.convergenceReads.clear()
      this.appliedLiveTextDeltas.clear()
      // A new Session starts a fresh ordering; a still queued task is allowed to drain first.
      this.lane.resetWhenIdle()
    }

    this.dispatch({
      type: 'session/opened',
      sessionId: input.sessionId,
      generation: this.generation,
      title: input.title ?? null,
      projectId: input.projectId ?? null,
    })
    this.publishMutationPending(this.lane.pending)
  }

  closeSession(): void {
    this.generation += 1
    this.abortSessionRequests()
    this.sceneStream.stop()
    this.initWorkflow.clear()
    this.dispatch({ type: 'session/closed', generation: this.generation })
  }

  /** Explicit action after a Scene create: 11C2 calls this when the user picks a Scene. */
  selectScene(sceneId: string | null): void {
    if (this.isInactive()) {
      return
    }
    if (sceneId === null) {
      this.sceneStream.stop()
      this.dispatch({ type: 'scene/selected', generation: this.generation, sceneId: null })
      return
    }

    const identity = this.resolveIdentity(sceneId)
    if (!identity) {
      return
    }

    this.sceneStream.stop()
    this.dispatch({ type: 'scene/selected', generation: this.generation, sceneId })
    this.sceneStream.start(identity)
    this.renderRefresh.schedule()
  }

  /**
   * Re-opens the stream of the selected Scene. A binding replay (StrictMode setup after a detach)
   * has the same Session and selection but no subscription, so the subscription is restored without
   * touching the Scene state or creating anything.
   */
  resumeSelectedScene(): void {
    if (this.isInactive() || this.sceneStream.peek() !== null) {
      return
    }
    const sceneId = this.state.selectedSceneId
    if (!sceneId) {
      return
    }
    const identity = this.resolveIdentity(sceneId)
    if (identity) {
      this.sceneStream.start(identity)
    }
  }

  /**
   * Refresh of the Scene index from the Session snapshot; this path never creates a Scene. The read
   * runs inside the Session mutation lane, so it can never interleave with a Scene creation (an
   * older snapshot can therefore not remove a Scene the lane just created), and concurrent callers
   * join the same read instead of duplicating it.
   */
  loadSceneIndex(): Promise<StudioCinemaIndexOutcome> {
    return this.initWorkflow.loadIndex()
  }

  /**
   * The one initialization workflow of a Session. A fresh Session is filled to the default Scene
   * count, sequentially, and a repeated call (StrictMode replay, a second tab action) joins the
   * running workflow instead of starting a second one.
   */
  initializeScenes(): Promise<StudioCinemaInitializationOutcome> {
    return this.initWorkflow.initialize()
  }

  /**
   * Continue after a partial failure or an unknown outcome: the index is reconciled first and a
   * Scene is created only after that read succeeded, so an unreachable server can never make the
   * client create duplicates.
   */
  continueSceneInitialization(): Promise<StudioCinemaInitializationOutcome> {
    return this.initWorkflow.continueInit()
  }

  /** Append: shares the Session mutation lane with initialization and has no client-side cap. */
  appendScene(): Promise<StudioCinemaAppendSceneOutcome> {
    return this.initWorkflow.append()
  }

  setDraft(sceneId: string, text: string): void {
    const identity = this.resolveIdentity(sceneId)
    if (identity) {
      this.dispatch({ type: 'draft/changed', identity, text })
    }
  }

  /**
   * Submit one Scene Run. Identity, draft version, text and the Provider config are captured before
   * the request leaves, so the answer can only land on the Scene it belongs to, and only the draft
   * version it captured may be cleared. Admission is the shared eligibility rule: the Scene must
   * have an authoritative snapshot, no active Run and no outcome still waiting for reconciliation.
   */
  async submitSceneRun(sceneId: string): Promise<StudioCinemaSubmitOutcome> {
    const identity = this.resolveIdentity(sceneId)
    const sessionId = this.state.session.id
    if (!identity || !sessionId || this.isInactive()) {
      return { status: 'no_session' }
    }

    const scene = selectSceneState(this.state, identity)
    if (!scene) {
      return { status: 'no_session' }
    }

    const eligibility = readStudioCinemaSceneEligibility(scene)
    if (!eligibility.canSubmit) {
      switch (eligibility.submitBlockReason) {
        case 'empty_draft':
          return { status: 'ignored_empty' }
        case 'submitting':
          return { status: 'ignored_busy' }
        default:
          return { status: 'ignored_not_ready', reason: eligibility.submitBlockReason ?? 'loading' }
      }
    }

    let provider: { customApiConfig?: CustomApiConfig; hasIncompleteProvider: boolean }
    try {
      provider = this.deps.provider.resolve()
    } catch {
      // A resolver that throws is a local failure with a stable code, never an unhandled rejection.
      this.dispatch({
        type: 'scene/feedback',
        identity,
        feedback: { code: 'provider_unavailable', needsReconciliation: false },
      })
      return { status: 'provider_unavailable' }
    }

    if (provider.hasIncompleteProvider) {
      this.dispatch({
        type: 'scene/feedback',
        identity,
        feedback: { code: 'provider_incomplete', needsReconciliation: false },
      })
      return { status: 'provider_incomplete' }
    }

    const generation = this.generation
    const input: StudioCreateSceneRunInput = {
      inputText: scene.draft,
      ...(this.state.session.projectId ? { projectId: this.state.session.projectId } : {}),
      ...(provider.customApiConfig ? { customApiConfig: provider.customApiConfig } : {}),
    }

    this.dispatch({ type: 'submit/started', identity })

    try {
      const response = await this.deps.api.createSceneRun(sessionId, sceneId, input, {
        signal: this.sessionSignal(),
      })
      if (this.isStaleGeneration(generation)) {
        return { status: 'stale' }
      }
      if (!isStudioCinemaAcceptedRunResponseForIdentity(identity, response)) {
        // 11C7-A: an accepted response for another Scene ends the submit as an unknown outcome; the
        // draft is kept and the user is told to reconcile.
        this.dispatch({
          type: 'submit/failed',
          identity,
          code: 'run_submit_unknown',
          unknownOutcome: true,
        })
        return { status: 'unknown', code: 'run_submit_unknown' }
      }
      this.dispatch({ type: 'submit/accepted', identity, response })
      return { status: 'accepted', runId: response.run.id }
    } catch (error) {
      if (this.isStaleGeneration(generation)) {
        return { status: 'stale' }
      }
      const mapped = readStudioCinemaRequestError('run_submit', error)
      this.dispatch({
        type: 'submit/failed',
        identity,
        code: mapped.code,
        unknownOutcome: mapped.unknownOutcome,
      })
      return mapped.unknownOutcome
        ? { status: 'unknown', code: mapped.code }
        : { status: 'failed', code: mapped.code }
    }
  }

  /**
   * Cancel exactly the active Run of one Scene, derived from the public Run records so a Run that
   * was restored by a snapshot is cancelable and a terminal Run never is. A second cancel of the
   * same Scene is refused synchronously while the first one is in flight.
   */
  async cancelSceneRun(sceneId: string): Promise<StudioCinemaCancelOutcome> {
    const identity = this.resolveIdentity(sceneId)
    if (!identity || this.isInactive()) {
      return { status: 'no_session' }
    }

    const scene = selectSceneState(this.state, identity)
    if (!scene) {
      return { status: 'no_session' }
    }
    if (scene.cancelRequested) {
      return { status: 'ignored_busy' }
    }

    const activeRun = readStudioCinemaActiveRun(scene)
    if (!activeRun) {
      return { status: 'no_active_run' }
    }

    const runId = activeRun.id
    const generation = this.generation
    this.dispatch({ type: 'cancel/started', identity })

    try {
      const response = await this.deps.api.cancelRun(runId)
      if (this.isStaleGeneration(generation)) {
        return { status: 'stale' }
      }
      const verdict = readStudioCinemaCancelRunVerdict(identity, runId, response)
      if (verdict.kind === 'rejected') {
        // 11C7 Review Correction: a present-but-foreign payload is a failure with an existing code and
        // a reconcile prompt, never a quiet success. `cancelRequested` ends either way, the draft and
        // the Run/Render records stay, and nothing is re-sent automatically.
        this.dispatch({
          type: 'cancel/settled',
          identity,
          targetRunId: runId,
          code: 'run_cancel_failed',
          needsReconciliation: true,
        })
        return { status: 'failed', code: 'run_cancel_failed' }
      }
      const run = verdict.kind === 'run' ? verdict.run : this.readStatusOnlyCancelRun(response.status, identity, scene, runId)
      this.dispatch({ type: 'cancel/settled', identity, targetRunId: runId, ...(run ? { run } : {}) })
      return { status: 'requested' }
    } catch (error) {
      if (this.isStaleGeneration(generation)) {
        return { status: 'stale' }
      }
      const mapped = readStudioCinemaRequestError('run_cancel', error)
      this.dispatch({ type: 'cancel/settled', identity, code: mapped.code })
      return { status: 'failed', code: mapped.code }
    }
  }

  /**
   * Reconciliation action: re-reads the Scene snapshot, never a blind re-submit. The read is the
   * convergence checkpoint, so a successful one also clears an unknown outcome and a pending
   * convergence, while a failed one keeps both.
   */
  async reconcileScene(sceneId: string): Promise<StudioCinemaSnapshotOutcome> {
    const identity = this.resolveIdentity(sceneId)
    if (!identity || this.isInactive()) {
      return 'stale'
    }

    return this.snapshotReader.requestSceneSnapshot(identity, 'manual-reconcile')
  }

  /**
   * Manual recovery from a paused render refresh: grants a fresh budget and restarts the loop for
   * that Scene. Returns whether a paused Scene was actually resumed; the pause is only ever a
   * statement about the loop and never rewrites the render outcome.
   */
  resumeSceneRenderRefresh(sceneId?: string): boolean {
    const target = sceneId ?? this.state.selectedSceneId
    if (!target || this.isInactive()) {
      return false
    }
    const identity = this.resolveIdentity(target)
    if (!identity) {
      return false
    }
    const record = selectSceneState(this.state, identity)
    if (!record || record.renderRefresh.status !== 'paused') {
      return false
    }

    // Ending the cycle first is what makes the resume authoritative: a tick that is still in flight
    // for the paused cycle loses its ownership and can never write into the resumed one.
    this.renderRefresh.end()
    this.dispatch({
      type: 'scene/render-refresh',
      identity,
      patch: { status: 'idle', pauseReason: null, refreshes: 0, consecutiveFailures: 0 },
    })
    if (this.state.selectedSceneId === target) {
      this.renderRefresh.schedule()
    }
    return true
  }

  /**
   * True when an awaited result belongs to a binding, Session generation or instance that has since
   * moved on: nothing may be written to the state in that case.
   */
  private isStaleGeneration(generation: number): boolean {
    return this.isInactive() || generation !== this.generation
  }

  /**
   * One Session mutation lane: Scene creation and the index read are serialized here, and the count
   * of queued plus running tasks is what `sceneMutationPending` reports, so a finishing task cannot
   * mark a still queued one idle.
   *
   * Every public entry queues, unconditionally: a running task never grants a caller permission to
   * run beside it, so a request that arrives while another one is in flight waits in order instead
   * of overtaking it. The task itself is the only thing that may run inside the lane; a lane task
   * that needs another lane operation must call the private, already-in-lane implementation rather
   * than a public entry, so reentrancy is declared by structure and never inferred from a flag.
   */
  /**
   * The pending flag is a fact about the lane, not about a Session generation, so it is published
   * against the generation the state currently holds (a detach bumps the counter without a state).
   */
  private publishMutationPending(pending: boolean): void {
    this.dispatch({
      type: 'session/mutation-pending',
      generation: this.state.session.generation,
      pending,
    })
  }

  private async recoverScene(
    identity: StudioCinemaSceneIdentity,
    generation: number,
    subscriptionId: number,
    epoch: number,
  ): Promise<void> {
    const first = await this.snapshotReader.startRecoverySceneSnapshot({
      kind: 'stream-recovery',
      generation,
      identity,
      revision: this.snapshotReader.bumpSnapshotRevision(identity),
      subscriptionId,
      epoch,
    })
    if (!this.recoverySlot.isCurrent(subscriptionId, epoch, !this.isInactive())) {
      return
    }
    const window = this.recoverySlot.current(subscriptionId)
    if (!window) {
      return
    }

    const firstReplay = takeBufferedRecoveryEvents(window, true)
    if (first !== 'ok') {
      // No read proved this window: the events it lost are still unproven, and a recovery that did
      // not answer must never read as in sync. A superseded window is owned by a newer read of the
      // same Scene, which covers what was received before it started.
      if (first !== STALE_RESULT) {
        if (firstReplay.incomplete) {
          this.markConvergencePending(identity)
        }
        // Idempotent record upserts are still applied, so a terminal Run/Render that arrived inside
        // the failed window keeps its checkpoint instead of being dropped with the window.
        this.replayRecoveryEvents(identity, firstReplay.events)
      }
      this.recoverySlot.finish(subscriptionId)
      return
    }

    if (firstReplay.incomplete) {
      this.markConvergencePending(identity)
    }
    // Replayed events go through the one shared rule, so a terminal Run/Render that arrived inside
    // the window schedules the same authoritative read a live one does.
    this.replayRecoveryEvents(identity, firstReplay.events)

    if (!firstReplay.overflowed) {
      this.recoverySlot.finish(subscriptionId)
      return
    }

    // One bounded second read: the record buffer overflowed, so the first snapshot may have missed
    // records that arrived while it was being read. What the first read lost is carried, so a failing
    // second read cannot make the window look complete again.
    window.unprovenCarried = firstReplay.incomplete
    window.discardedTextCount = 0
    window.overflowed = false
    window.recordEvents = []
    window.buffering = true
    const second = await this.snapshotReader.startRecoverySceneSnapshot({
      kind: 'stream-recovery',
      generation,
      identity,
      revision: this.snapshotReader.bumpSnapshotRevision(identity),
      subscriptionId,
      epoch,
    })
    if (!this.recoverySlot.isCurrent(subscriptionId, epoch, !this.isInactive())) {
      return
    }
    const secondReplay = takeBufferedRecoveryEvents(window, true)
    // A read covers everything received before it started, so the second read converges the first
    // one's losses; it cannot cover its own window, and a failed second read leaves the first
    // window's losses unproven. Both stay pending instead of claiming a complete state.
    if (secondReplay.incomplete || (second !== 'ok' && window.unprovenCarried)) {
      this.markConvergencePending(identity)
    }
    this.replayRecoveryEvents(identity, secondReplay.events)
    this.recoverySlot.finish(subscriptionId)
  }

  /** Replays buffered record events through the one rule every applied record event uses. */
  private replayRecoveryEvents(identity: StudioCinemaSceneIdentity, events: StudioCinemaSceneEvent[]): void {
    for (const event of events) {
      this.handleSceneRecordEvent(identity, event)
    }
  }

  /** One applied record event: the state write and the convergence checkpoint are a single rule. */
  private handleSceneRecordEvent(identity: StudioCinemaSceneIdentity, event: StudioCinemaSceneEvent): void {
    this.dispatch({
      type: 'scene/event',
      identity,
      event,
      receivedAt: this.deps.clock.now(),
    })
    if (isStudioCinemaTextDeltaEvent(event)) {
      const key = buildStudioCinemaSceneKey(identity)
      this.appliedLiveTextDeltas.set(key, (this.appliedLiveTextDeltas.get(key) ?? 0) + 1)
    }
    this.maybeScheduleConvergenceRead(identity, event)
    this.renderRefresh.schedule()
  }

  /** One pending convergence, as disclosed to the user and to the next checkpoint read. */
  private markConvergencePending(identity: StudioCinemaSceneIdentity): void {
    this.dispatch({
      type: 'scene/convergence-pending',
      identity,
      at: this.deps.clock.now(),
    })
  }

  /**
   * A terminal Run/Render is a determinable checkpoint: while the Scene still has a pending
   * convergence, one authoritative read is scheduled so the display converges instead of keeping a
   * suspected gap forever. One read at a time per Scene; a failed or superseded one leaves the
   * pending flag in place for the next checkpoint instead of looping.
   */
  private maybeScheduleConvergenceRead(identity: StudioCinemaSceneIdentity, event: StudioCinemaSceneEvent): void {
    const scene = selectSceneState(this.state, identity)
    if (!scene?.convergencePending) {
      return
    }

    const isCheckpoint =
      (event.kind === 'run-updated' && isStudioCinemaTerminalRunStatus(event.run.status)) ||
      (event.kind === 'render-updated' && isStudioCinemaTerminalRenderStatus(event.render.status))
    if (!isCheckpoint) {
      return
    }

    const key = buildStudioCinemaSceneKey(identity)
    if (this.convergenceReads.has(key)) {
      return
    }

    this.convergenceReads.add(key)
    const liveTextAtStart = this.appliedLiveTextDeltas.get(key) ?? 0
    void this.snapshotReader.requestSceneSnapshot(identity, 'convergence')
      .then((outcome) => {
        if (outcome !== 'ok') {
          return
        }
        if ((this.appliedLiveTextDeltas.get(key) ?? 0) !== liveTextAtStart) {
          // Assistant text arrived while this read was in flight and the snapshot replaced the
          // message list: the read proves nothing about its own window, so the Scene stays marked.
          this.markConvergencePending(identity)
        }
      })
      .finally(() => {
        this.convergenceReads.delete(key)
      })
      .catch(() => undefined)
  }

  /**
   * Case A only: the official status-only response carries no `run` at all, so the target's own stored
   * record is updated with the validated top-level status. The identity rule still applies to it, and a
   * malformed or foreign payload never reaches this method (it is case C).
   */
  private readStatusOnlyCancelRun(
    status: StudioRunStatus,
    identity: StudioCinemaSceneIdentity,
    scene: StudioCinemaSceneState,
    runId: string,
  ): StudioSceneRun | null {
    const existing = scene.runs.find((run) => run.id === runId)
    if (!existing || !isStudioCinemaSceneRunForIdentity(identity, existing)) {
      return null
    }
    return { ...existing, status }
  }

  private sessionSignal(): AbortSignal {
    return this.sessionAbort.signal
  }

  private resetSessionRequests(): void {
    this.sessionAbort = new AbortController()
  }

  private abortSessionRequests(): void {
    this.sessionAbort.abort()
  }

  private isInactive(): boolean {
    return this.disposed || !this.attached
  }

  private resolveIdentity(sceneId: string): StudioCinemaSceneIdentity | null {
    const sessionId = this.state.session.id
    if (!sessionId || !this.state.sceneOrder.includes(sceneId)) {
      return null
    }
    if (!this.state.scenes[buildStudioCinemaSceneKey({ sessionId, sceneId })]) {
      return null
    }
    return { sessionId, sceneId }
  }

  private dispatch(action: StudioCinemaAction): void {
    const next = studioCinemaReducer(this.state, action)
    if (next === this.state) {
      return
    }
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const defaultDependencies: StudioCinemaControllerDependencies = {
  api: {
    createScene: (sessionId, options) => createStudioScene(sessionId, options),
    reorderScenes: (sessionId, sceneIds) => reorderStudioScenes(sessionId, sceneIds),
    getSceneSnapshot: (sessionId, sceneId, options) => getStudioSceneSnapshot(sessionId, sceneId, options),
    getSessionSnapshot: (sessionId, options) => getStudioSessionSnapshot(sessionId, options),
    createSceneRun: (sessionId, sceneId, input, options) =>
      createStudioSceneRun(sessionId, sceneId, input, options),
    // Preserve property presence: an absent Run is the status-only compatibility shape;
    // explicitly supplied malformed/null Runs must still reach the verdict as rejected.
    cancelRun: (runId) => cancelStudioRun({ runId }),
  },
  provider: { resolve: () => resolveStudioProviderConfig() },
  events: { subscribe: (options) => subscribeStudioEvents(options) },
  clock: { now: () => Date.now() },
  createAbortController: () => new AbortController(),
  createWorkflowId: () => `cinema-init-${Math.random().toString(36).slice(2)}`,
  scheduler: {
    schedule: (delayMs, task) => {
      const handle = setTimeout(task, delayMs)
      return () => clearTimeout(handle)
    },
  },
}

/**
 * Production entry. The default dependencies are the real Studio API, Provider resolution and Scene
 * event stream; a Spec injects fakes for all of them.
 */
export function createStudioCinemaController(
  overrides?: Partial<StudioCinemaControllerDependencies>,
): StudioCinemaController {
  return new StudioCinemaController({ ...defaultDependencies, ...overrides })
}
