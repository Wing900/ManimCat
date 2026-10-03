/**
 * The Scene event stream subscription the Cinema controller holds for the selected Scene.
 *
 * One stream at a time: a new selection replaces it, and the previous subscription is aborted. The
 * stream owns the subscription counter, the active stream record and the frame/status routing; the
 * controller owns the event-applier (the state write) and the recovery orchestration, reached
 * through the host callbacks so the stream never reads the controller's state shape directly.
 */
import { isSameStudioCinemaScene, type StudioCinemaSceneEvent, type StudioCinemaSceneIdentity } from '../types'
import type { StudioCinemaAction } from '../scene-reducer'
import { bufferRecoveryEvent, type RecoveryWindowSlot } from './recovery-window'
import { decodeStudioCinemaSceneEvent } from '../scene-events'
import { readStudioCinemaRequestError } from './request-error'
import type { StudioCinemaEventSourcePort } from '../cinema-controller'
import type { StudioEventConnectionStatus } from '../../api/studio-agent-events'

export interface ActiveStream {
  subscriptionId: number
  identity: StudioCinemaSceneIdentity
  controller: AbortController
  /** Bumped on every real connection; the recovery window of one epoch is one connection. */
  epoch: number
  connected: boolean
}

/**
 * The controller surface the stream needs. `isStreamActive` folds the disposed / session check so
 * the stream's ownership guard never reads the controller's state shape; `onSceneRecordEvent` and
 * `onConnectionReady` hand the decoded event and the real-connection signal back so the controller
 * owns the state write and the recovery read.
 */
export interface SceneStreamHost {
  isStaleGeneration(generation: number): boolean
  isStreamActive(identity: StudioCinemaSceneIdentity): boolean
  generation(): number
  dispatch(action: StudioCinemaAction): void
  onSceneRecordEvent(identity: StudioCinemaSceneIdentity, event: StudioCinemaSceneEvent): void
  onConnectionReady(
    identity: StudioCinemaSceneIdentity,
    generation: number,
    subscriptionId: number,
    epoch: number,
  ): void
  renderRefreshEnd(): void
}

export class SceneStream {
  private subscriptionCounter = 0
  private stream: ActiveStream | null = null
  private readonly host: SceneStreamHost
  private readonly recoverySlot: RecoveryWindowSlot
  private readonly events: StudioCinemaEventSourcePort
  private readonly createAbortController: () => AbortController

  constructor(
    host: SceneStreamHost,
    recoverySlot: RecoveryWindowSlot,
    events: StudioCinemaEventSourcePort,
    createAbortController: () => AbortController,
  ) {
    this.host = host
    this.recoverySlot = recoverySlot
    this.events = events
    this.createAbortController = createAbortController
  }

  /** The active stream record, for ownership verdicts that read its epoch and connection state. */
  peek(): ActiveStream | null {
    return this.stream
  }

  start(identity: StudioCinemaSceneIdentity): void {
    const subscriptionId = this.subscriptionCounter + 1
    this.subscriptionCounter = subscriptionId
    const controller = this.createAbortController()
    this.stream = { subscriptionId, identity, controller, epoch: 0, connected: false }
    this.recoverySlot.clear()

    this.host.dispatch({ type: 'scene/loading', identity })
    const generation = this.host.generation()

    void this.events
      .subscribe({
        signal: controller.signal,
        scope: { kind: 'scene', sessionId: identity.sessionId, sceneId: identity.sceneId },
        onEvent: (event) => this.handleStreamFrame(subscriptionId, identity, event),
        onStatusChange: (status) => this.handleStreamStatus(subscriptionId, identity, status),
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || this.host.isStaleGeneration(generation)) {
          return
        }
        this.host.dispatch({
          type: 'scene/stream-state',
          identity,
          state: 'disconnected',
          attempt: 0,
        })
        const mapped = readStudioCinemaRequestError('snapshot', error)
        this.host.dispatch({
          type: 'scene/feedback',
          identity,
          feedback: {
            code: mapped.unknownOutcome ? 'stream_disconnected' : mapped.code,
            needsReconciliation: false,
          },
        })
        this.recoverySlot.stop(subscriptionId)
      })
  }

  /** True while this stream is still the one the selected Scene's session owns. */
  isActive(subscriptionId: number, identity: StudioCinemaSceneIdentity): boolean {
    const stream = this.stream
    return (
      stream !== null &&
      stream.subscriptionId === subscriptionId &&
      isSameStudioCinemaScene(stream.identity, identity) &&
      this.host.isStreamActive(identity)
    )
  }

  stop(): void {
    // The refresh loop belongs to the selected Scene: nothing may keep ticking for a Scene the
    // binding no longer watches. Ending the cycle also orphans a tick that is still in flight, so its
    // late response cannot write into the next visit.
    this.host.renderRefreshEnd()
    const stream = this.stream
    this.stream = null
    this.recoverySlot.clear()
    if (stream) {
      stream.controller.abort()
    }
  }

  private handleStreamFrame(
    subscriptionId: number,
    identity: StudioCinemaSceneIdentity,
    frame: unknown,
  ): void {
    if (!this.isActive(subscriptionId, identity)) {
      return
    }

    const decoded = decodeStudioCinemaSceneEvent(frame)
    if (!decoded) {
      // Unknown type or malformed frame: dropped, never applied to a Scene record.
      return
    }

    if (!decoded.identity) {
      if (decoded.event.kind === 'connection' && decoded.event.state === 'connected') {
        // The backend's own connection frame and the transport's `connected` status describe the
        // same connection, so the recovery window is opened once.
        this.handleConnectionReady(subscriptionId, identity)
      }
      return
    }

    if (!isSameStudioCinemaScene(decoded.identity, identity)) {
      // A sibling Scene, another Session or a Legacy frame: never merged into this Scene.
      return
    }

    const window = this.recoverySlot.current(subscriptionId)
    if (window && window.buffering) {
      bufferRecoveryEvent(window, decoded.event)
      return
    }

    this.host.onSceneRecordEvent(identity, decoded.event)
  }

  private handleStreamStatus(
    subscriptionId: number,
    identity: StudioCinemaSceneIdentity,
    status: StudioEventConnectionStatus,
  ): void {
    if (!this.isActive(subscriptionId, identity)) {
      return
    }

    this.host.dispatch({
      type: 'scene/stream-state',
      identity,
      state: status.state,
      attempt: status.attempt,
    })

    if (status.state === 'connected') {
      this.handleConnectionReady(subscriptionId, identity)
      return
    }

    if (status.state === 'reconnecting' || status.state === 'disconnected') {
      const stream = this.stream
      if (stream && stream.subscriptionId === subscriptionId) {
        // The next connection is a new epoch with its own recovery window.
        stream.connected = false
      }
      this.recoverySlot.stop(subscriptionId)
      if (status.state === 'disconnected') {
        this.host.dispatch({
          type: 'scene/feedback',
          identity,
          feedback: { code: 'stream_disconnected', needsReconciliation: false },
        })
      }
    }
  }

  /**
   * A real connection is the only thing that starts recovery: the snapshot is read after the
   * transport reported `connected` (or after the backend's connection frame), never in parallel
   * with an unproven connection. Every reconnection opens a fresh window.
   */
  private handleConnectionReady(subscriptionId: number, identity: StudioCinemaSceneIdentity): void {
    if (!this.isActive(subscriptionId, identity)) {
      return
    }
    const stream = this.stream
    if (!stream || stream.connected) {
      return
    }

    stream.connected = true
    stream.epoch += 1
    const epoch = stream.epoch
    this.host.dispatch({ type: 'scene/recovery-started', identity })
    this.recoverySlot.open({
      subscriptionId,
      epoch,
      identity,
      buffering: true,
      recordEvents: [],
      discardedTextCount: 0,
      overflowed: false,
      unprovenCarried: false,
    })
    this.host.onConnectionReady(identity, this.host.generation(), subscriptionId, epoch)
  }
}