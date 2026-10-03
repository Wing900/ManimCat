/**
 * One authoritative Scene snapshot read, shared by the render refresh loop, convergence, manual
 * reconciliation and recovery. The reader owns the snapshot revision counter and the per-Scene
 * read de-duplication; the controller owns the session context, the dispatch and the render
 * refresh scheduling, reached through the host interface so the reader never reads the controller's
 * state shape directly.
 */
import { buildStudioCinemaSceneKey, type StudioCinemaSceneIdentity } from '../types'
import type { StudioCinemaAction } from '../scene-reducer'
import {
  readStudioCinemaSnapshotOwnershipVerdict,
  type StudioCinemaSnapshotOwnership,
  type StudioCinemaSnapshotOwnershipVerdict,
} from '../recovery-ownership'
import { isStudioCinemaSceneSnapshotForIdentity } from '../scene-response-identity'
import { STALE_RESULT, readStudioCinemaRequestError, type StudioCinemaSnapshotOutcome } from './request-error'
import type { ActiveStream, SceneStream } from './scene-stream'
import type { RecoveryWindow, RecoveryWindowSlot } from './recovery-window'
import type { StudioSceneSnapshot } from '../../protocol/studio-agent-types'
import type { StudioRequestOptions } from '../../api/studio-agent-api'

export interface SnapshotReaderHost {
  isInactive(): boolean
  generation(): number
  sessionId(): string | null
  dispatch(action: StudioCinemaAction): void
  renderRefreshSchedule(): void
  sessionSignal(): AbortSignal
  getSceneSnapshot(
    sessionId: string,
    sceneId: string,
    options?: StudioRequestOptions,
  ): Promise<StudioSceneSnapshot>
}

export class SceneSnapshotReader {
  private readonly snapshotRevisions = new Map<string, number>()
  private readonly sceneReads = new Map<string, Promise<StudioCinemaSnapshotOutcome>>()
  private readonly host: SnapshotReaderHost
  private readonly sceneStream: SceneStream
  private readonly recoverySlot: RecoveryWindowSlot

  constructor(host: SnapshotReaderHost, sceneStream: SceneStream, recoverySlot: RecoveryWindowSlot) {
    this.host = host
    this.sceneStream = sceneStream
    this.recoverySlot = recoverySlot
  }

  /**
   * One authoritative read per Scene at a time, shared by convergence, manual reconciliation and the
   * render refresh loop. A caller that finds a read already running joins it instead of starting a
   * newer one, so two of them can never bump each other's revision in a loop; the outcome they get
   * back is the same record, and `superseded` simply means a newer read (a recovery, or a user
   * action) already answered for this Scene.
   */
  requestSceneSnapshot(
    identity: StudioCinemaSceneIdentity,
    kind: 'convergence' | 'manual-reconcile' | 'refresh',
  ): Promise<StudioCinemaSnapshotOutcome> {
    const key = buildStudioCinemaSceneKey(identity)
    const existing = this.sceneReads.get(key)
    if (existing) {
      return existing
    }

    const generation = this.host.generation()
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
  startRecoverySceneSnapshot(
    ownership: StudioCinemaSnapshotOwnership,
  ): Promise<StudioCinemaSnapshotOutcome> {
    const key = buildStudioCinemaSceneKey(ownership.identity)
    return this.trackSceneRead(key, this.readSceneSnapshot(ownership))
  }

  bumpSnapshotRevision(identity: StudioCinemaSceneIdentity): number {
    const key = buildStudioCinemaSceneKey(identity)
    const next = (this.snapshotRevisions.get(key) ?? 0) + 1
    this.snapshotRevisions.set(key, next)
    return next
  }

  /** Clears the revision counters; a new Session starts with no proven revision. */
  clearRevisions(): void {
    this.snapshotRevisions.clear()
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
      const snapshot = await this.host.getSceneSnapshot(identity.sessionId, identity.sceneId, {
        signal: this.host.sessionSignal(),
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
        this.host.dispatch({ type: 'scene/snapshot-failed', identity, code: 'snapshot_failed' })
        return 'failed'
      }
      this.host.dispatch({ type: 'scene/snapshot', identity, snapshot })
      this.host.renderRefreshSchedule()
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
      this.host.dispatch({ type: 'scene/snapshot-failed', identity, code: mapped.code })
      return 'failed'
    }
  }

  /** The current facts one ownership is judged against; nothing is cached between reads. */
  private readSnapshotOwnershipVerdict(
    ownership: StudioCinemaSnapshotOwnership,
  ): StudioCinemaSnapshotOwnershipVerdict {
    const stream: ActiveStream | null = this.sceneStream.peek()
    const window: RecoveryWindow | null = this.recoverySlot.peek()
    return readStudioCinemaSnapshotOwnershipVerdict(ownership, {
      inactive: this.host.isInactive(),
      generation: this.host.generation(),
      sessionId: this.host.sessionId(),
      revision: this.snapshotRevisions.get(buildStudioCinemaSceneKey(ownership.identity)) ?? 0,
      stream: stream
        ? { subscriptionId: stream.subscriptionId, epoch: stream.epoch, connected: stream.connected }
        : null,
      recoveryWindow: window
        ? { subscriptionId: window.subscriptionId, epoch: window.epoch }
        : null,
    })
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
}