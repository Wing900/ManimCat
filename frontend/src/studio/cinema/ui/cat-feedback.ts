import type { TranslationKey } from '../../../i18n/messages'

/**
 * Cat feedback (doc §7): a pure map from the Scene's cat status to the one short sentence the cat
 * says, plus the dedup kind that drives how long it stays.
 *
 * The long-form `studio.cinema.cat*` keys (locked by `cinema-labels.test.ts`) stay the source of
 * state; this layer only narrows them into the ≤24-char bubble of doc §7.2. No second status
 * reducer, no event subscription, no clock: it is a pure function of the status key.
 */

export type CatFeedbackKind = 'resting' | 'transient' | 'persistent'

export interface CatFeedback {
  /** Short bubble sentence (≤24 chars / two lines). */
  bubbleKey: TranslationKey
  /** How the bubble times out: resting fades fast, transient fades after a few seconds, persistent stays. */
  kind: CatFeedbackKind
  /** Whether the failure has a stable recover entry the user can click (doc §7.2). */
  hasRecoverEntry: boolean
}

/** Map a cat status key to its short bubble. Pure; no state, no clock, no side effect. */
export function readStudioCinemaCatFeedback(statusKey: TranslationKey): CatFeedback {
  switch (statusKey) {
    case 'studio.cinema.catSubmitting':
      return { bubbleKey: 'studio.cinema.catBubbleStart', kind: 'transient', hasRecoverEntry: false }
    case 'studio.cinema.catWorking':
      return { bubbleKey: 'studio.cinema.catBubbleWorking', kind: 'transient', hasRecoverEntry: false }
    case 'studio.cinema.catFailed':
      return { bubbleKey: 'studio.cinema.catBubbleFailed', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catNeedsCheck':
      return { bubbleKey: 'studio.cinema.catBubbleCheck', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catReconnecting':
      return { bubbleKey: 'studio.cinema.catBubbleReconnect', kind: 'persistent', hasRecoverEntry: false }
    case 'studio.cinema.catUnreachable':
      return { bubbleKey: 'studio.cinema.catBubbleUnreachable', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catRefreshPaused':
      return { bubbleKey: 'studio.cinema.catBubbleRefresh', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catIdle':
      return { bubbleKey: 'studio.cinema.catBubbleIdle', kind: 'resting', hasRecoverEntry: false }
    default:
      // An unknown status never invents a sentence: the cat stays quiet rather than guessing.
      return { bubbleKey: 'studio.cinema.catBubbleIdle', kind: 'resting', hasRecoverEntry: false }
  }
}

/**
 * Completion (doc §7.2 "做好了") and cancellation ("已经停下来了") are transitions, not states: the
 * controller returns to `catIdle` once a Run finishes. This pure helper reads the previous and the
 * current status key and returns the one-shot transition bubble, or null when there is none.
 *
 * It only fires on a reliable working → idle transition (no failed outcome in between), so a stream
 * reconnect or a snapshot reload never re-announces "done".
 */
export function readStudioCinemaCatTransition(
  previous: TranslationKey | null,
  current: TranslationKey,
  currentFailed: boolean,
): { bubbleKey: TranslationKey; kind: 'transient' } | null {
  const wasWorking = previous === 'studio.cinema.catWorking' || previous === 'studio.cinema.catSubmitting'
  if (!wasWorking) {
    return null
  }
  if (current === 'studio.cinema.catIdle' && !currentFailed) {
    return { bubbleKey: 'studio.cinema.catBubbleDone', kind: 'transient' }
  }
  return null
}