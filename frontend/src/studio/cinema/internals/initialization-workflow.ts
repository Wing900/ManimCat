/**
 * The one initialization workflow of a Session, plus the Scene-create and index-read primitives it
 * shares with the controller's append path.
 *
 * A fresh Session is filled to the default Scene count, sequentially, through a mutation lane; a
 * repeated call (StrictMode replay, a second tab action) joins the running workflow instead of
 * starting a second one. The workflow publishes its identity and its joinable promise *before* the
 * work begins (P1), so the create path's ownership check sees the slot synchronously and a slot
 * registered only after the call would make every fresh initialization resolve `stale` without
 * creating anything. Every awaited result is re-checked for staleness inside the lane, right before
 * the request leaves and right after it returns: a queued task must not act for a Session,
 * generation or target that changed while it waited. Nothing here derives a Run/Render outcome from
 * a connection state.
 *
 * The controller supplies the session context (state, generation, dispatch), the mutation lane, the
 * API port, the session abort signal, the Scene stream lifecycle hooks and the Scene selection.
 */
import type { StudioScene } from '../../protocol/studio-agent-types'
import { STUDIO_CINEMA_DEFAULT_SCENE_COUNT, type StudioCinemaFeedbackCode, type StudioCinemaState } from '../types'
import type { StudioCinemaAction } from '../scene-reducer'
import { STALE_RESULT, readStudioCinemaRequestError } from './request-error'
import type {
  StudioCinemaApiPort,
  StudioCinemaIndexOutcome,
  StudioCinemaInitializationOutcome,
} from '../cinema-controller'

export type StudioCinemaAppendSceneOutcome =
  | { status: 'created'; scene: StudioScene }
  | { status: 'failed' | 'unknown'; code: StudioCinemaFeedbackCode }
  | { status: 'no_session' | 'stale' }

export interface InitializationWorkflowHost {
  state(): StudioCinemaState
  generation(): number
  isStaleGeneration(generation: number): boolean
  isInactive(): boolean
  dispatch(action: StudioCinemaAction): void
  laneRun<T>(task: () => Promise<T>): Promise<T>
  api(): StudioCinemaApiPort
  createWorkflowId(): string
  sessionSignal(): AbortSignal
  sceneStreamHasActive(): boolean
  sceneStreamStop(): void
  selectScene(sceneId: string): void
}

/**
 * A workflow slot whose identity is visible to concurrent callers *before* its work begins (P1).
 * The create path reaches its first ownership check synchronously, so a slot registered only after
 * `run` was called would make every fresh initialization look stale.
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

export class InitializationWorkflow {
  private initialization: { id: number; promise: Promise<StudioCinemaInitializationOutcome> } | null = null
  private workflowCounter = 0
  private indexRead: Promise<StudioCinemaIndexOutcome> | null = null

  private readonly host: InitializationWorkflowHost

  constructor(host: InitializationWorkflowHost) {
    this.host = host
  }

  /** Drop the running workflow and the in-flight index read; called on detach / session switch / close. */
  clear(): void {
    this.initialization = null
    this.indexRead = null
  }

  loadIndex(): Promise<StudioCinemaIndexOutcome> {
    if (this.indexRead) {
      return this.indexRead
    }

    const promise = this.performLoadIndex().finally(() => {
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
  initialize(): Promise<StudioCinemaInitializationOutcome> {
    if (this.host.isInactive()) {
      return Promise.resolve({ status: 'stale' })
    }
    const sessionId = this.host.state().session.id
    if (!sessionId) {
      return Promise.resolve({ status: 'failed', createdCount: 0, code: 'session_not_found' })
    }
    if (this.host.state().initialization.status === 'ready') {
      return Promise.resolve({ status: 'already_ready', createdCount: this.host.state().sceneOrder.length })
    }
    if (this.host.state().initialization.status === 'partial' || this.host.state().initialization.status === 'failed') {
      // A retried initialization is a continue: reconcile first, then create only what is missing.
      return this.continueInit()
    }
    if (this.initialization) {
      return this.initialization.promise
    }

    return this.start(sessionId, false)
  }

  /**
   * Continue after a partial failure or an unknown outcome: the index is reconciled first and a
   * Scene is created only after that read succeeded, so an unreachable server can never make the
   * client create duplicates.
   */
  continueInit(): Promise<StudioCinemaInitializationOutcome> {
    if (this.host.isInactive()) {
      return Promise.resolve({ status: 'stale' })
    }
    const sessionId = this.host.state().session.id
    if (!sessionId) {
      return Promise.resolve({ status: 'failed', createdCount: 0, code: 'session_not_found' })
    }
    if (this.initialization) {
      return this.initialization.promise
    }

    return this.start(sessionId, true)
  }

  /** Append: shares the Session mutation lane with initialization and has no client-side cap. */
  async append(): Promise<StudioCinemaAppendSceneOutcome> {
    const sessionId = this.host.state().session.id
    if (!sessionId || this.host.isInactive()) {
      return { status: 'no_session' }
    }

    const generation = this.host.generation()
    const outcome = await this.createSceneOnce(generation, sessionId)
    if (outcome.status === 'stale') {
      return { status: 'stale' }
    }
    if (outcome.status === 'satisfied') {
      return { status: 'failed', code: 'scene_create_failed' }
    }

    return outcome
  }

  private start(sessionId: string, refreshFirst: boolean): Promise<StudioCinemaInitializationOutcome> {
    const id = this.workflowCounter + 1
    this.workflowCounter = id
    // P1: publish the identity and the joinable promise *before* starting the work. The create path
    // checks `isCurrent` synchronously, so a slot registered after the call would make every
    // fresh initialization resolve `stale` without creating anything.
    const slot = createStudioCinemaWorkflowSlot<StudioCinemaInitializationOutcome>()
    this.initialization = { id, promise: slot.promise }
    try {
      void this.run(id, sessionId, refreshFirst, this.host.createWorkflowId()).then(
        (outcome) => slot.resolve(outcome),
        (error: unknown) => slot.reject(error),
      )
    } catch (error) {
      // A synchronous failure (e.g. workflow id creation) settles the published promise too, and the
      // slot is released by identity: leaving it published would make every later `initialize`
      // join this rejected promise instead of starting a real workflow.
      if (this.initialization?.id === id) {
        this.initialization = null
      }
      slot.reject(error)
    }
    return slot.promise
  }

  private async run(
    workflowSlot: number,
    sessionId: string,
    refreshFirst: boolean,
    workflowLabel: string,
  ): Promise<StudioCinemaInitializationOutcome> {
    const generation = this.host.generation()
    this.host.dispatch({
      type: 'initialization/patch',
      generation,
      patch: { status: 'creating', workflowId: workflowLabel, feedback: null },
    })

    try {
      if (refreshFirst) {
        const reconciled = await this.loadIndex()
        if (!this.isCurrent(workflowSlot, sessionId, generation)) {
          return { status: 'stale' }
        }
        if (reconciled === 'stale') {
          return { status: 'stale' }
        }
        if (reconciled === 'failed') {
          // No Scene is created on top of an index that could not be reconciled.
          return this.finishWithFailure(generation, 'snapshot_failed', true)
        }
      }

      const target = Math.max(this.host.state().initialization.targetCount, STUDIO_CINEMA_DEFAULT_SCENE_COUNT)

      while (this.host.state().sceneOrder.length < target) {
        if (!this.isCurrent(workflowSlot, sessionId, generation)) {
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
          return this.finishWithFailure(
            generation,
            outcome.code,
            outcome.status === 'unknown',
          )
        }
      }

      const createdCount = this.host.state().sceneOrder.length
      this.host.dispatch({
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

  private finishWithFailure(
    generation: number,
    code: StudioCinemaFeedbackCode,
    unknownOutcome: boolean,
  ): StudioCinemaInitializationOutcome {
    const createdCount = this.host.state().sceneOrder.length
    const feedback = { code, needsReconciliation: unknownOutcome }
    this.host.dispatch({
      type: 'initialization/patch',
      generation,
      patch: { status: createdCount > 0 ? 'partial' : 'failed', createdCount, feedback },
    })
    this.host.dispatch({ type: 'session/feedback', generation, feedback })
    return createdCount > 0
      ? { status: 'partial', createdCount, code }
      : { status: 'failed', createdCount, code }
  }

  /** The workflow slot, the Session and the generation the workflow started in must all still hold. */
  private isCurrent(workflowSlot: number, sessionId: string, generation: number): boolean {
    return (
      !this.host.isStaleGeneration(generation) &&
      this.initialization?.id === workflowSlot &&
      this.host.state().session.id === sessionId
    )
  }

  private async performLoadIndex(): Promise<StudioCinemaIndexOutcome> {
    const sessionId = this.host.state().session.id
    if (!sessionId || this.host.isInactive()) {
      return STALE_RESULT
    }

    const generation = this.host.generation()
    return this.host.laneRun(async () => {
      if (this.host.isStaleGeneration(generation) || this.host.state().session.id !== sessionId) {
        return STALE_RESULT
      }

      try {
        const snapshot = await this.host.api().getSessionSnapshot(sessionId, { signal: this.host.sessionSignal() })
        if (this.host.isStaleGeneration(generation) || this.host.state().session.id !== sessionId) {
          return STALE_RESULT
        }
        this.host.dispatch({ type: 'session/index', generation, scenes: snapshot.scenes ?? [] })
        if (this.host.state().selectedSceneId === null && this.host.sceneStreamHasActive()) {
          // The selected Scene is gone from the index: its stream must not outlive the selection.
          this.host.sceneStreamStop()
        }
        return 'ok'
      } catch (error) {
        if (this.host.isStaleGeneration(generation) || this.host.state().session.id !== sessionId) {
          return STALE_RESULT
        }
        const mapped = readStudioCinemaRequestError('snapshot', error)
        this.host.dispatch({
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
    return this.host.laneRun(async () => {
      // Re-checked inside the lane, right before the request leaves: a queued task must not act for
      // a Session, generation or target that changed while it waited.
      if (this.host.isStaleGeneration(generation) || this.host.state().session.id !== sessionId) {
        return { status: 'stale' }
      }
      if (targetCount !== undefined && this.host.state().sceneOrder.length >= targetCount) {
        return { status: 'satisfied' }
      }

      try {
        const scene = await this.host.api().createScene(sessionId, { signal: this.host.sessionSignal() })
        if (this.host.isStaleGeneration(generation) || this.host.state().session.id !== sessionId) {
          return { status: 'stale' }
        }
        this.host.dispatch({ type: 'scene/created', scene })
        this.host.dispatch({
          type: 'initialization/patch',
          generation,
          patch: { createdCount: this.host.state().initialization.createdCount + 1 },
        })
        this.selectFirstSceneIfUnselected(scene.id)
        return { status: 'created', scene }
      } catch (error) {
        if (this.host.isStaleGeneration(generation) || this.host.state().session.id !== sessionId) {
          return { status: 'stale' }
        }
        const mapped = readStudioCinemaRequestError('scene_create', error)
        this.host.dispatch({
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
    if (this.host.state().selectedSceneId === null) {
      this.host.selectScene(sceneId)
    }
  }
}