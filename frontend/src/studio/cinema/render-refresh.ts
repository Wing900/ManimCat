/**
 * The render refresh loop of the Cinema controller's selected Scene.
 *
 * One cycle polls the Scene's snapshot until its wait set (the ids of its unfinished Manim renders)
 * drains or a bound is hit, then pauses and says so. A new render, another Scene, another Session or
 * a detached binding replaces the cycle, which is what gives a new render its own budget instead of
 * inheriting the previous counter, backoff or pause. The controller owns the snapshot read and the
 * session context; this module owns the cycle, the token, the budget and the backoff.
 */
import {
  isSameStudioCinemaScene,
  STUDIO_CINEMA_RENDER_REFRESH_BACKOFF_MAX_MS,
  STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS,
  STUDIO_CINEMA_RENDER_REFRESH_MAX_CONSECUTIVE_FAILURES,
  STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT,
  type StudioCinemaRenderRefreshPauseReason,
  type StudioCinemaRenderRefreshState,
  type StudioCinemaSceneIdentity,
  type StudioCinemaSceneState,
} from './types'
import { readStudioCinemaRenderWaitTarget } from './scene-selectors'
import type { StudioCinemaAction } from './scene-state'
import type { StudioCinemaScheduler } from './cinema-controller'
import type { StudioCinemaSnapshotOutcome } from './request-error'

export interface RenderRefreshCycle {
  readonly token: number
  readonly identity: StudioCinemaSceneIdentity
  readonly generation: number
  readonly target: string
  timer: { cancel: () => void } | null
  running: boolean
}

/**
 * The controller surface the scheduler needs. `isCycleCurrent` folds the disposed / generation /
 * session / scene checks so the scheduler never reads the controller's state shape directly, and
 * `selectedScene` hands back the identity, the scene and the generation in one read so the cycle
 * record is built from a single snapshot of the selection.
 */
export interface RenderRefreshHost {
  isInactive(): boolean
  isCycleCurrent(cycle: RenderRefreshCycle): boolean
  selectedScene(): { identity: StudioCinemaSceneIdentity; scene: StudioCinemaSceneState; generation: number } | null
  sceneState(identity: StudioCinemaSceneIdentity): StudioCinemaSceneState | null
  dispatch(action: StudioCinemaAction): void
  requestSceneSnapshot(identity: StudioCinemaSceneIdentity, kind: 'refresh'): Promise<StudioCinemaSnapshotOutcome>
}

/** Interval of a healthy loop, or a capped exponential backoff while it is failing. */
function readStudioCinemaRenderRefreshDelay(refresh: StudioCinemaRenderRefreshState): number {
  if (refresh.consecutiveFailures <= 0) {
    return STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS
  }
  const backoff = STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS * 2 ** refresh.consecutiveFailures
  return Math.min(backoff, STUDIO_CINEMA_RENDER_REFRESH_BACKOFF_MAX_MS)
}

export class RenderRefreshScheduler {
  private cycle: RenderRefreshCycle | null = null
  private token = 0
  private readonly host: RenderRefreshHost
  private readonly scheduler: StudioCinemaScheduler

  constructor(host: RenderRefreshHost, scheduler: StudioCinemaScheduler) {
    this.host = host
    this.scheduler = scheduler
  }

  schedule(): void {
    if (this.host.isInactive()) {
      this.end()
      return
    }

    const selected = this.host.selectedScene()
    if (!selected) {
      this.end()
      return
    }
    const { identity, scene: opened, generation } = selected

    const target = readStudioCinemaRenderWaitTarget(opened)
    if (!target) {
      // Nothing left to wait for: end the cycle and report idle. A finished wait says nothing about
      // the next render, so the counter, the backoff and a stale pause are all reset here.
      this.end()
      this.resetRenderRefreshState(identity, { status: 'idle' })
      return
    }

    const previous = this.cycle
    const replaced =
      previous !== null &&
      (!isSameStudioCinemaScene(previous.identity, identity) ||
        previous.generation !== generation ||
        previous.target !== target)
    if (replaced) {
      // A different wait: another render set, another Scene visit or another Session. The old cycle
      // keeps its token, so a tick of it still in flight can never write into the new cycle.
      this.end()
    }
    if (!this.cycle) {
      this.cycle = {
        token: ++this.token,
        identity,
        generation,
        target,
        timer: null,
        running: false,
      }
      if (replaced) {
        // Only a *different* wait gets a fresh budget: a remount or a detach/attach round trip of the
        // same wait keeps its counter and its pause, so re-mounting cannot be used to poll forever.
        this.resetRenderRefreshState(identity, { status: 'active' })
      }
    }

    const cycle = this.cycle
    const scene = this.host.sceneState(identity) ?? opened
    // One slot per cycle: a pending timer or a running tick is its single occupant, so the loop can
    // neither overlap itself nor count one joined read twice.
    if (cycle.running || cycle.timer) {
      return
    }
    if (scene.renderRefresh.status === 'paused') {
      // Paused for this wait target; only an explicit resume re-arms this cycle.
      return
    }

    const delay = readStudioCinemaRenderRefreshDelay(scene.renderRefresh)
    cycle.timer = {
      cancel: this.scheduler.schedule(delay, () => {
        cycle.timer = null
        cycle.running = true
        void this.runTick(cycle)
      }),
    }
    if (scene.renderRefresh.status !== 'active') {
      this.host.dispatch({ type: 'scene/render-refresh', identity, patch: { status: 'active' } })
    }
  }

  /**
   * One tick of one cycle. Ownership is re-read after every await, so a response that belongs to a
   * replaced cycle, another Scene visit or another Session is dropped without touching a counter.
   */
  private async runTick(cycle: RenderRefreshCycle): Promise<void> {
    const identity = cycle.identity
    if (!this.owns(cycle)) {
      return
    }
    const scheduled = this.host.sceneState(identity)
    if (!scheduled || !readStudioCinemaRenderWaitTarget(scheduled)) {
      this.schedule()
      return
    }

    let outcome: StudioCinemaSnapshotOutcome = 'failed'
    try {
      outcome = await this.host.requestSceneSnapshot(identity, 'refresh')
    } finally {
      cycle.running = false
    }
    if (!this.owns(cycle)) {
      return
    }

    const scene = this.host.sceneState(identity)
    if (!scene) {
      return
    }
    if (readStudioCinemaRenderWaitTarget(scene) !== cycle.target) {
      // The wait set changed while the read was in flight (a render finished, or another appeared).
      // This outcome belongs to a wait nobody is waiting for any more: it consumes no budget, and the
      // new target decides for itself. An emptied set lands in the idle branch of the scheduler.
      this.schedule()
      return
    }
    if (outcome !== 'ok' && outcome !== 'failed') {
      // Superseded or stale: a later authoritative read already owns the truth. That is neither a
      // success nor a failure for this wait, so nothing is counted and the budget is untouched.
      this.schedule()
      return
    }

    const refreshes = scene.renderRefresh.refreshes + (outcome === 'ok' ? 1 : 0)
    const consecutiveFailures =
      outcome === 'failed' ? scene.renderRefresh.consecutiveFailures + 1 : 0
    const pauseReason: StudioCinemaRenderRefreshPauseReason | null =
      outcome === 'failed'
        ? consecutiveFailures >= STUDIO_CINEMA_RENDER_REFRESH_MAX_CONSECUTIVE_FAILURES
          ? 'failures'
          : null
        : refreshes >= STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT
          ? 'budget'
          : null

    this.host.dispatch({
      type: 'scene/render-refresh',
      identity,
      patch: {
        status: pauseReason ? 'paused' : 'active',
        pauseReason,
        refreshes,
        consecutiveFailures,
      },
    })

    if (pauseReason) {
      this.end()
      return
    }
    this.schedule()
  }

  /** True while this cycle is still the one the selected Scene's current wait belongs to. */
  private owns(cycle: RenderRefreshCycle): boolean {
    return this.cycle === cycle && this.host.isCycleCurrent(cycle)
  }

  /**
   * Ends the current cycle. Its token stays unique forever, so a tick still in flight when the cycle
   * ends can never write into whatever replaces it. Ending a cycle never rewrites a render.
   */
  end(): void {
    const cycle = this.cycle
    if (!cycle) {
      return
    }
    this.cycle = null
    cycle.timer?.cancel()
    cycle.timer = null
  }

  /** Resets the loop counters of a Scene: a new wait starts with a full budget and no pause. */
  private resetRenderRefreshState(
    identity: StudioCinemaSceneIdentity,
    patch: { status: 'idle' | 'active' },
  ): void {
    const scene = this.host.sceneState(identity)
    if (!scene) {
      return
    }
    const refresh = scene.renderRefresh
    if (
      refresh.status === patch.status &&
      refresh.pauseReason === null &&
      refresh.refreshes === 0 &&
      refresh.consecutiveFailures === 0
    ) {
      return
    }
    this.host.dispatch({
      type: 'scene/render-refresh',
      identity,
      patch: { status: patch.status, pauseReason: null, refreshes: 0, consecutiveFailures: 0 },
    })
  }
}