import type { TranslationKey } from '../../../i18n/messages'

/**
 * Cat feedback (doc §7): what the cat says, and how long it stays.
 *
 * The cat never invents a sentence. Its bubble repeats the opening of its own reply — the first few
 * characters of the newest assistant message for this Scene, then an ellipsis — so what the user reads
 * in the bubble is really what the cat said. A canned state report survives only for states the
 * assistant cannot describe itself: a failure, a reconnect, an unreadable status, a paused refresh.
 * Those carry the one recover entry the user can click.
 */

export type CatFeedbackKind = 'transient' | 'persistent'

export interface CatFeedback {
  /** The state report to show (only used for states the assistant cannot state itself). */
  bubbleKey: TranslationKey
  /** How the bubble times out: transient fades after a few seconds, persistent stays until it clears. */
  kind: CatFeedbackKind
  /** Whether the state has a stable recover entry the user can click (doc §7.2). */
  hasRecoverEntry: boolean
}

/** How many characters of the reply the bubble repeats before the ellipsis. */
export const CAT_REPLY_SNIPPET_MAX_CHARS = 15

/**
 * The opening of a real reply, flattened to one line: markdown markers and runs of whitespace collapse
 * so the bubble reads as speech rather than markup, and the snippet ends on an ellipsis because it is
 * only the beginning of what the cat said.
 *
 * Returns an empty string when there is nothing to repeat, so the caller stays quiet instead of
 * showing an empty bubble.
 */
export function readStudioCinemaCatReplySnippet(text: string, max = CAT_REPLY_SNIPPET_MAX_CHARS): string {
  const flat = text
    .replace(/\s+/g, ' ')
    .replace(/^[#>*`\-–—\s]+/, '')
    .replace(/[*`~]/g, '')
    .trim()
  const chars = Array.from(flat)
  if (chars.length === 0) {
    return ''
  }
  return `${chars.length > max ? chars.slice(0, max).join('') : flat}…`
}

/**
 * Map a cat status key to the state report the assistant cannot give itself. Pure; no state, no clock.
 *
 * `catIdle`, `catSubmitting` and `catWorking` return `null` on purpose: those moments are carried by
 * the reply's own opening, and an unknown status never invents a sentence either.
 */
export function readStudioCinemaCatFeedback(statusKey: TranslationKey): CatFeedback | null {
  switch (statusKey) {
    case 'studio.cinema.catFailed':
      return { bubbleKey: 'studio.cinema.catBubbleFailed', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catNeedsCheck':
      return { bubbleKey: 'studio.cinema.catBubbleCheck', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catUnreachable':
      return { bubbleKey: 'studio.cinema.catBubbleUnreachable', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catRefreshPaused':
      return { bubbleKey: 'studio.cinema.catBubbleRefresh', kind: 'persistent', hasRecoverEntry: true }
    case 'studio.cinema.catReconnecting':
      // The cat is handling the reconnect itself, so there is nothing for the user to click.
      return { bubbleKey: 'studio.cinema.catBubbleReconnect', kind: 'persistent', hasRecoverEntry: false }
    default:
      return null
  }
}
