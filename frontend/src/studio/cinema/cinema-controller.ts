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
import {
  readStudioCinemaSnapshotOwnershipVerdict,
  type StudioCinemaSnapshotOwnership,
  type StudioCinemaSnapshotOwnershipVerdict,
} from './recovery-ownership'
import { readStudioCinemaRequestError, type StudioCinemaSnapshotOutcome } from './request-error'
import { RecoveryWindowSlot, takeBufferedRecoveryEvents } from './recovery-window'
import { MutationLane } from './mutation-lane'
import { RenderRefreshScheduler } from './render-refresh'
import { SceneStream } from './scene-stream'
import { selectSceneState, studioCinemaReducer, type StudioCinemaAction } from './scene-state'
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
  STUDIO_CINEMA_DEFAULT_SCENE_COUNT,
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
  isStudioCinemaSceneSnapshotForIdentity,
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

const STALE_RESULT = 'stale' as const

/**
 * A workflow slot whose identity is visible to concurrent callers *before* its work begins (P1).
 * The create path reaches its first ownership check synchronously, so a slot registered only after
 * `runInitialization` was called would make every fresh initialization look stale.
 */
function createStudioCinemaWorkflowSlot<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export class StudioCinemaController {
  private readonly deps: StudioCinemaControllerDependencies
  private readonly listeners = new Set<() => void>()
  private state: StudioCinemaState = createInitialStudioCinemaState()
  private generation = 0
  private sceneStream: SceneStream
  private recoverySlot = new RecoveryWindowSlot()
  private lane = new MutationLane((pending) => this.publishMutationPending(pending))
  private initialization: { id: number; promise: Promise<StudioCinemaInitializationOutcome> } | null = null
  private workflowCounter = 0
  private indexRead: Promise<StudioCinemaIndexOutcome> | null = null
  private readonly snapshotRevisions = new Map<string, number>()
  private readonly convergenceReads = new Set<string>()
  /**
   * In-flight authoritative reads per Scene. Recovery, convergence, refresh and a manual reconcile
   * all arbitrate through this map, so two of them can never supersede each other in a loop: the
   * second caller joins the read that is already running.
   */
  private readonly sceneReads = new Map<string, Promise<StudioCinemaSnapshotOutcome>>()
  /**
   * The render refresh loop of the selected Scene. The scheduler owns the cycle, the token and the
   * budget; this controller supplies the snapshot read and the session context through the host
   * interface.
   */
  private renderRefresh: RenderRefreshScheduler
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
        requestSceneSnapshot: (identity, kind) => this.requestSceneSnapshot(identity, kind),
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
    this.indexRead = null
    this.initialization = null
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
      this.initialization = null
      this.indexRead = null
      this.snapshotRevisions.clear()
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
    this.initialization = null
    this.indexRead = null
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
    if (this.indexRead) {
      return this.indexRead
    }

    const promise = this.performLoadSceneIndex().finally(() => {
      if (this.indexRead === promise) {
        this.indexRead = null
      }
    })
    this.indexRead = promise
    return promise
  }

  /**
   * The one initialization workflow of a Session. A fresh Session is filled to the default Scene
   * count, sequentially, and a repeated call (StrictMode replay, a second tab action) joins the
   * running workflow instead of starting a second one.
   */
  initializeScenes(): Promise<StudioCinemaInitializationOutcome> {
    if (this.isInactive()) {
      return Promise.resolve({ status: 'stale' })
    }
    const sessionId = this.state.session.id
    if (!sessionId) {
      return Promise.resolve({ status: 'failed', createdCount: 0, code: 'session_not_found' })
    }
    if (this.state.initialization.status === 'ready') {
      return Promise.resolve({ status: 'already_ready', createdCount: this.state.sceneOrder.length })
    }
    if (this.state.initialization.status === 'partial' || this.state.initialization.status === 'failed') {
      // A retried initialization is a continue: reconcile first, then create only what is missing.
      return this.continueSceneInitialization()
    }
    if (this.initialization) {
      return this.initialization.promise
    }

    return this.startInitializationWorkflow(sessionId, false)
  }

  /**
   * Continue after a partial failure or an unknown outcome: the index is reconciled first and a
   * Scene is created only after that read succeeded, so an unreachable server can never make the
   * client create duplicates.
   */
  continueSceneInitialization(): Promise<StudioCinemaInitializationOutcome> {
    if (this.isInactive()) {
      return Promise.resolve({ status: 'stale' })
    }
    const sessionId = this.state.session.id
    if (!sessionId) {
      return Promise.resolve({ status: 'failed', createdCount: 0, code: 'session_not_found' })
    }
    if (this.initialization) {
      return this.initialization.promise
    }

    return this.startInitializationWorkflow(sessionId, true)
  }

  /** Append: shares the Session mutation lane with initialization and has no client-side cap. */
  async appendScene(): Promise<
    | { status: 'created'; scene: StudioScene }
    | { status: 'failed' | 'unknown'; code: StudioCinemaFeedbackCode }
    | { status: 'no_session' | 'stale' }
  > {
    const sessionId = this.state.session.id
    if (!sessionId || this.isInactive()) {
      return { status: 'no_session' }
    }

    const generation = this.generation
    const outcome = await this.createSceneOnce(generation, sessionId)
    if (outcome.status === 'stale') {
      return { status: 'stale' }
    }
    if (outcome.status === 'satisfied') {
      return { status: 'failed', code: 'scene_create_failed' }
    }

    return outcome
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

    return this.requestSceneSnapshot(identity, 'manual-reconcile')
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

  private startInitializationWorkflow(
    sessionId: string,
    refreshFirst: boolean,
  ): Promise<StudioCinemaInitializationOutcome> {
    const id = this.workflowCounter + 1
    this.workflowCounter = id
    // P1: publish the identity and the joinable promise *before* starting the work. The create path
    // checks `isWorkflowCurrent` synchronously, so a slot registered after the call would make every
    // fresh initialization resolve `stale` without creating anything.
    const slot = createStudioCinemaWorkflowSlot<StudioCinemaInitializationOutcome>()
    this.initialization = { id, promise: slot.promise }
    try {
      void this.runInitialization(id, sessionId, refreshFirst, this.deps.createWorkflowId()).then(
        (outcome) => slot.resolve(outcome),
        (error: unknown) => slot.reject(error),
      )
    } catch (error) {
      // A synchronous failure (e.g. workflow id creation) settles the published promise too, and the
      // slot is released by identity: leaving it published would make every later `initializeScenes`
      // join this rejected promise instead of starting a real workflow.
      if (this.initialization?.id === id) {
        this.initialization = null
      }
      slot.reject(error)
    }
    return slot.promise
  }

  private async runInitialization(
    workflowSlot: number,
    sessionId: string,
    refreshFirst: boolean,
    workflowLabel: string,
  ): Promise<StudioCinemaInitializationOutcome> {
    const generation = this.generation
    this.dispatch({
      type: 'initialization/patch',
      generation,
      patch: { status: 'creating', workflowId: workflowLabel, feedback: null },
    })

    try {
      if (refreshFirst) {
        const reconciled = await this.loadSceneIndex()
        if (!this.isWorkflowCurrent(workflowSlot, sessionId, generation)) {
          return { status: 'stale' }
        }
        if (reconciled === 'stale') {
          return { status: 'stale' }
        }
        if (reconciled === 'failed') {
          // No Scene is created on top of an index that could not be reconciled.
          return this.finishInitializationWithFailure(generation, 'snapshot_failed', true)
        }
      }

      const target = Math.max(this.state.initialization.targetCount, STUDIO_CINEMA_DEFAULT_SCENE_COUNT)

      while (this.state.sceneOrder.length < target) {
        if (!this.isWorkflowCurrent(workflowSlot, sessionId, generation)) {
          return { status: 'stale' }
        }

        const outcome = await this.createSceneOnce(generation, sessionId, target)
        if (outcome.status === 'stale') {
          return { status: 'stale' }
        }
        if (outcome.status === 'satisfied') {
          // The lane noticed that another request already filled the target: never over-create.
          continue
        }
        if (outcome.status !== 'created') {
          return this.finishInitializationWithFailure(
            generation,
            outcome.code,
            outcome.status === 'unknown',
          )
        }
      }

      const createdCount = this.state.sceneOrder.length
      this.dispatch({
        type: 'initialization/patch',
        generation,
        patch: { status: 'ready', createdCount, feedback: null },
      })
      return { status: 'ready', createdCount }
    } finally {
      if (this.initialization?.id === workflowSlot) {
        // Only the workflow that owns the slot clears it; a replay's workflow is never cleared by an
        // older one finishing.
        this.initialization = null
      }
    }
  }

  private finishInitializationWithFailure(
    generation: number,
    code: StudioCinemaFeedbackCode,
    unknownOutcome: boolean,
  ): StudioCinemaInitializationOutcome {
    const createdCount = this.state.sceneOrder.length
    const feedback = { code, needsReconciliation: unknownOutcome }
    this.dispatch({
      type: 'initialization/patch',
      generation,
      patch: { status: createdCount > 0 ? 'partial' : 'failed', createdCount, feedback },
    })
    this.dispatch({ type: 'session/feedback', generation, feedback })
    return createdCount > 0
      ? { status: 'partial', createdCount, code }
      : { status: 'failed', createdCount, code }
  }

  /** The workflow slot, the Session and the generation the workflow started in must all still hold. */
  private isWorkflowCurrent(workflowSlot: number, sessionId: string, generation: number): boolean {
    return (
      !this.isStaleGeneration(generation) &&
      this.initialization?.id === workflowSlot &&
      this.state.session.id === sessionId
    )
  }

  /**
   * True when an awaited result belongs to a binding, Session generation or instance that has since
   * moved on: nothing may be written to the state in that case.
   */
  private isStaleGeneration(generation: number): boolean {
    return this.isInactive() || generation !== this.generation
  }

  private async performLoadSceneIndex(): Promise<StudioCinemaIndexOutcome> {
    const sessionId = this.state.session.id
    if (!sessionId || this.isInactive()) {
      return STALE_RESULT
    }

    const generation = this.generation
    return this.lane.run(async () => {
      if (this.isStaleGeneration(generation) || this.state.session.id !== sessionId) {
        return STALE_RESULT
      }

      try {
        const snapshot = await this.deps.api.getSessionSnapshot(sessionId, { signal: this.sessionSignal() })
        if (this.isStaleGeneration(generation) || this.state.session.id !== sessionId) {
          return STALE_RESULT
        }
        this.dispatch({ type: 'session/index', generation, scenes: snapshot.scenes ?? [] })
        if (this.state.selectedSceneId === null && this.sceneStream.peek() !== null) {
          // The selected Scene is gone from the index: its stream must not outlive the selection.
          this.sceneStream.stop()
        }
        return 'ok'
      } catch (error) {
        if (this.isStaleGeneration(generation) || this.state.session.id !== sessionId) {
          return STALE_RESULT
        }
        const mapped = readStudioCinemaRequestError('snapshot', error)
        this.dispatch({
          type: 'session/feedback',
          generation,
          feedback: { code: mapped.code, needsReconciliation: mapped.unknownOutcome },
        })
        return 'failed'
      }
    })
  }

  private async createSceneOnce(
    generation: number,
    sessionId: string,
    targetCount?: number,
  ): Promise<
    | { status: 'created'; scene: StudioScene }
    | { status: 'failed'; code: StudioCinemaFeedbackCode }
    | { status: 'unknown'; code: StudioCinemaFeedbackCode }
    | { status: 'satisfied' }
    | { status: 'stale' }
  > {
    return this.lane.run(async () => {
      // Re-checked inside the lane, right before the request leaves: a queued task must not act for
      // a Session, generation or target that changed while it waited.
      if (this.isStaleGeneration(generation) || this.state.session.id !== sessionId) {
        return { status: 'stale' }
      }
      if (targetCount !== undefined && this.state.sceneOrder.length >= targetCount) {
        return { status: 'satisfied' }
      }

      try {
        const scene = await this.deps.api.createScene(sessionId, { signal: this.sessionSignal() })
        if (this.isStaleGeneration(generation) || this.state.session.id !== sessionId) {
          return { status: 'stale' }
        }
        this.dispatch({ type: 'scene/created', scene })
        this.dispatch({
          type: 'initialization/patch',
          generation,
          patch: { createdCount: this.state.initialization.createdCount + 1 },
        })
        this.selectFirstSceneIfUnselected(scene.id)
        return { status: 'created', scene }
      } catch (error) {
        if (this.isStaleGeneration(generation) || this.state.session.id !== sessionId) {
          return { status: 'stale' }
        }
        const mapped = readStudioCinemaRequestError('scene_create', error)
        this.dispatch({
          type: 'session/feedback',
          generation,
          feedback: { code: mapped.code, needsReconciliation: mapped.unknownOutcome },
        })
        return mapped.unknownOutcome
          ? { status: 'unknown', code: mapped.code }
          : { status: 'failed', code: mapped.code }
      }
    })
  }

  /** The first created Scene is shown only while nothing is selected; a user choice is never overridden. */
  private selectFirstSceneIfUnselected(sceneId: string): void {
    if (this.state.selectedSceneId === null) {
      this.selectScene(sceneId)
    }
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
    const first = await this.startRecoverySceneSnapshot({
      kind: 'stream-recovery',
      generation,
      identity,
      revision: this.bumpSnapshotRevision(identity),
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
    const second = await this.startRecoverySceneSnapshot({
      kind: 'stream-recovery',
      generation,
      identity,
      revision: this.bumpSnapshotRevision(identity),
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
    void this.requestSceneSnapshot(identity, 'convergence')
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
   * One authoritative Scene read and the single apply gate. The ownership verdict is read
   * immediately before the dispatch, so a response whose stream, epoch, Session generation or
   * revision moved on is dropped before it can write anything into a Scene.
   */
  private async readSceneSnapshot(
    ownership: StudioCinemaSnapshotOwnership,
  ): Promise<StudioCinemaSnapshotOutcome> {
    const identity = ownership.identity

    try {
      const snapshot = await this.deps.api.getSceneSnapshot(identity.sessionId, identity.sceneId, {
        signal: this.sessionSignal(),
      })
      const verdict = this.readSnapshotOwnershipVerdict(ownership)
      if (verdict === 'stale') {
        return STALE_RESULT
      }
      if (verdict === 'superseded') {
        return 'superseded'
      }
      if (!isStudioCinemaSceneSnapshotForIdentity(identity, snapshot)) {
        // 11C7-A: a payload that names another Scene is refused, and the read still ends so the Scene
        // is never left in `loading`; nothing from the foreign payload is written.
        this.dispatch({ type: 'scene/snapshot-failed', identity, code: 'snapshot_failed' })
        return 'failed'
      }
      this.dispatch({ type: 'scene/snapshot', identity, snapshot })
      this.renderRefresh.schedule()
      return 'ok'
    } catch (error) {
      const verdict = this.readSnapshotOwnershipVerdict(ownership)
      if (verdict === 'stale') {
        return STALE_RESULT
      }
      if (verdict === 'superseded') {
        return 'superseded'
      }
      const mapped = readStudioCinemaRequestError('snapshot', error)
      this.dispatch({ type: 'scene/snapshot-failed', identity, code: mapped.code })
      return 'failed'
    }
  }

  /** The current facts one ownership is judged against; nothing is cached between reads. */
  private readSnapshotOwnershipVerdict(
    ownership: StudioCinemaSnapshotOwnership,
  ): StudioCinemaSnapshotOwnershipVerdict {
    const stream = this.sceneStream.peek()
    const window = this.recoverySlot.peek()
    return readStudioCinemaSnapshotOwnershipVerdict(ownership, {
      inactive: this.isInactive(),
      generation: this.generation,
      sessionId: this.state.session.id,
      revision: this.snapshotRevisions.get(buildStudioCinemaSceneKey(ownership.identity)) ?? 0,
      stream: stream
        ? { subscriptionId: stream.subscriptionId, epoch: stream.epoch, connected: stream.connected }
        : null,
      recoveryWindow: window
        ? { subscriptionId: window.subscriptionId, epoch: window.epoch }
        : null,
    })
  }

  /**
   * One authoritative read per Scene at a time, shared by convergence, manual reconciliation and the
   * render refresh loop. A caller that finds a read already running joins it instead of starting a
   * newer one, so two of them can never bump each other's revision in a loop; the outcome they get
   * back is the same record, and `superseded` simply means a newer read (a recovery, or a user
   * action) already answered for this Scene.
   */
  private requestSceneSnapshot(
    identity: StudioCinemaSceneIdentity,
    kind: 'convergence' | 'manual-reconcile' | 'refresh',
  ): Promise<StudioCinemaSnapshotOutcome> {
    const key = buildStudioCinemaSceneKey(identity)
    const existing = this.sceneReads.get(key)
    if (existing) {
      return existing
    }

    const generation = this.generation
    const ownership: StudioCinemaSnapshotOwnership =
      kind === 'manual-reconcile'
        ? { kind, generation, identity, revision: this.bumpSnapshotRevision(identity) }
        : { kind: 'convergence', generation, identity, revision: this.bumpSnapshotRevision(identity) }

    return this.trackSceneRead(key, this.readSceneSnapshot(ownership))
  }

  /**
   * A recovery read is the newest view of its Scene and never joins: it starts its own read (so it
   * owns the revision its window will verify) while converging readers join it.
   */
  private startRecoverySceneSnapshot(
    ownership: StudioCinemaSnapshotOwnership,
  ): Promise<StudioCinemaSnapshotOutcome> {
    const key = buildStudioCinemaSceneKey(ownership.identity)
    return this.trackSceneRead(key, this.readSceneSnapshot(ownership))
  }

  private trackSceneRead(
    key: string,
    read: Promise<StudioCinemaSnapshotOutcome>,
  ): Promise<StudioCinemaSnapshotOutcome> {
    const tracked = read.finally(() => {
      if (this.sceneReads.get(key) === tracked) {
        this.sceneReads.delete(key)
      }
    })
    this.sceneReads.set(key, tracked)
    return tracked
  }

  private bumpSnapshotRevision(identity: StudioCinemaSceneIdentity): number {
    const key = buildStudioCinemaSceneKey(identity)
    const next = (this.snapshotRevisions.get(key) ?? 0) + 1
    this.snapshotRevisions.set(key, next)
    return next
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
