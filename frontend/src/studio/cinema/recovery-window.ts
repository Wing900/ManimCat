/**
 * The reconnect buffering slot used by the Cinema controller.
 *
 * One Scene's event stream is recovered through a single {@link RecoveryWindow}: while the window
 * is buffering, record events are collected instead of applied, and a snapshot read proves what the
 * window lost. The window is opened on a real connection and closed once the read converges; the
 * controller owns that orchestration, this module owns the buffer and the slot.
 */
import {
  isStudioCinemaTextDeltaEvent,
  STUDIO_CINEMA_RECOVERY_BUFFER_LIMIT,
  type StudioCinemaSceneEvent,
  type StudioCinemaSceneIdentity,
} from './types'

export interface RecoveryWindow {
  subscriptionId: number
  epoch: number
  identity: StudioCinemaSceneIdentity
  buffering: boolean
  recordEvents: StudioCinemaSceneEvent[]
  discardedTextCount: number
  overflowed: boolean
  /**
   * An earlier read of this same window already lost events and no successful read has covered them
   * yet. It survives the counter reset of the bounded second read, so a failed second read cannot
   * make the window look complete again.
   */
  unprovenCarried: boolean
}

/**
 * Assistant text is discarded inside a window because the protocol has no cursor: the delta may or
 * may not already be inside the snapshot, and merging it would duplicate content that the client
 * cannot deduplicate by text. Record events are idempotent upserts and are kept.
 */
export function bufferRecoveryEvent(window: RecoveryWindow, event: StudioCinemaSceneEvent): void {
  if (isStudioCinemaTextDeltaEvent(event)) {
    window.discardedTextCount += 1
    return
  }
  if (window.recordEvents.length >= STUDIO_CINEMA_RECOVERY_BUFFER_LIMIT) {
    window.overflowed = true
    window.recordEvents = []
    return
  }
  window.recordEvents.push(event)
}

/**
 * Closes one buffering period and hands the record events back for replay. The counters are read
 * before they are reset, so nothing that was lost disappears silently, and `overflowed` reports
 * whether this period needs the bounded second read.
 */
export function takeBufferedRecoveryEvents(
  window: RecoveryWindow,
  stopBuffering: boolean,
): { events: StudioCinemaSceneEvent[]; incomplete: boolean; overflowed: boolean } {
  const events = window.recordEvents
  const result = {
    events,
    incomplete: window.discardedTextCount > 0 || window.overflowed,
    overflowed: window.overflowed,
  }
  window.recordEvents = []
  if (stopBuffering) {
    window.buffering = false
  }
  return result
}

/**
 * Owns the single active {@link RecoveryWindow}. The controller never holds the window directly;
 * it asks the slot for the window that matches the stream it is recovering, and clears the slot when
 * the stream ends or a new connection opens.
 */
export class RecoveryWindowSlot {
  private window: RecoveryWindow | null = null

  open(window: RecoveryWindow): void {
    this.window = window
  }

  /** The window bound to a subscription, or null if the slot holds a different subscription. */
  current(subscriptionId: number): RecoveryWindow | null {
    const window = this.window
    return window && window.subscriptionId === subscriptionId ? window : null
  }

  /** The raw window regardless of subscription, for ownership verdicts that read its epoch. */
  peek(): RecoveryWindow | null {
    return this.window
  }

  isCurrent(subscriptionId: number, epoch: number, isActive: boolean): boolean {
    const window = this.window
    return (
      isActive &&
      window !== null &&
      window.subscriptionId === subscriptionId &&
      window.epoch === epoch
    )
  }

  finish(subscriptionId: number): void {
    const window = this.current(subscriptionId)
    if (window) {
      window.buffering = false
      window.recordEvents = []
    }
  }

  stop(subscriptionId: number): void {
    const window = this.current(subscriptionId)
    if (window) {
      window.buffering = false
      window.recordEvents = []
      this.window = null
    }
  }

  clear(): void {
    this.window = null
  }
}