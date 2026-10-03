import type { StudioCinemaSceneIdentity } from './types'

/**
 * Ownership of one authoritative Scene snapshot read (task 11C1, recovery correction).
 *
 * A read may be written into the Scene state only while the ownership under which it started still
 * holds. The verdict below is what the controller consults immediately before the dispatch, so a
 * response whose owner has moved on is dropped *before* it can mark a Scene `ready` — there is no
 * "check after the write" path.
 *
 * - `stream-recovery`: a read that belongs to one connection epoch of the selected Scene stream. A
 *   disconnection, a newer epoch, a selection change or a closed window invalidates it, because the
 *   data it carries was requested for a Scene view that no longer exists.
 * - `manual-reconcile` / `convergence`: a read that is owned by the binding, the Session generation
 *   and the Scene identity only. It never pretends to be a stream recovery, so it is not invalidated
 *   by the stream, while it still loses to a newer read of the same Scene (latest-wins by revision).
 *
 * The revision gate is shared by every kind: a read that is no longer the newest read of its Scene
 * is superseded, so an older response can never overwrite a newer one.
 */
export type StudioCinemaSnapshotOwnership =
  | {
      kind: 'stream-recovery'
      generation: number
      identity: StudioCinemaSceneIdentity
      revision: number
      subscriptionId: number
      epoch: number
    }
  | {
      kind: 'manual-reconcile' | 'convergence'
      generation: number
      identity: StudioCinemaSceneIdentity
      revision: number
    }

/** The controller facts an ownership is judged against; all of them are current as of the check. */
export interface StudioCinemaSnapshotOwnershipFacts {
  /** The binding is detached, the controller disposed, or the Session was closed. */
  inactive: boolean
  generation: number
  sessionId: string | null
  /** The newest revision of that Scene; a read of an older revision is superseded. */
  revision: number
  /** The selected Scene stream, when one is open. */
  stream: { subscriptionId: number; epoch: number; connected: boolean } | null
  /** The recovery window, when one is open. */
  recoveryWindow: { subscriptionId: number; epoch: number } | null
}

export type StudioCinemaSnapshotOwnershipVerdict = 'valid' | 'stale' | 'superseded'

export function readStudioCinemaSnapshotOwnershipVerdict(
  ownership: StudioCinemaSnapshotOwnership,
  facts: StudioCinemaSnapshotOwnershipFacts,
): StudioCinemaSnapshotOwnershipVerdict {
  if (
    facts.inactive ||
    facts.generation !== ownership.generation ||
    facts.sessionId !== ownership.identity.sessionId
  ) {
    // The binding, the Session generation or the Session itself moved on: the response belongs to a
    // view nobody is watching, so it is stale rather than merely superseded.
    return 'stale'
  }

  if (facts.revision !== ownership.revision) {
    return 'superseded'
  }

  if (ownership.kind !== 'stream-recovery') {
    return 'valid'
  }

  const stream = facts.stream
  const window = facts.recoveryWindow
  if (!stream || !window) {
    // The stream was stopped or the window closed while the read was in flight.
    return 'superseded'
  }
  if (
    stream.subscriptionId !== ownership.subscriptionId ||
    stream.epoch !== ownership.epoch ||
    !stream.connected
  ) {
    // Another subscription (selection change) or a newer/disconnected epoch owns the Scene now.
    return 'superseded'
  }
  if (window.subscriptionId !== ownership.subscriptionId || window.epoch !== ownership.epoch) {
    return 'superseded'
  }

  return 'valid'
}
