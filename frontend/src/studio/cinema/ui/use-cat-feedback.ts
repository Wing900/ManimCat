import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import {
  readStudioCinemaCatFeedback,
  readStudioCinemaCatReplySnippet,
  type CatFeedbackKind,
} from './cat-feedback'

/**
 * Cat bubble content, timing and isolation (doc §7.1, §7.2).
 *
 * - the bubble repeats the opening of the cat's own reply (the newest assistant message of this
 *   Scene); a state report appears only for a state the assistant cannot state itself;
 * - while a run is in flight and this Scene has not answered for it yet, the cat types (three dots)
 *   instead of replaying the previous reply — the stale "instant answer" is never shown;
 * - a Scene's existing reply is history, not news: only a reply that arrives while the Scene is open
 *   pops the bubble, so opening a Scene with history never replays it;
 * - the same reply id does not re-pop the bubble while its text streams in;
 * - scene/session switch clears the bubble immediately, so a delayed event from another Scene never
 *   lands here;
 * - a transient bubble fades after a few seconds, a persistent state report stays until it clears;
 * - hover or focus pauses the fade.
 *
 * All ref bookkeeping and state mutation happen in a `useLayoutEffect` (the same pattern
 * `SceneHistoryPanel` uses for its reading-position bookkeeping), so the render stays pure.
 */

const TRANSIENT_FADE_MS = 5000

export interface CatBubble {
  /** The reply's own opening, shown verbatim. */
  text?: string
  /** Or a state report resolved through i18n. Exactly one of `text` / `bubbleKey` is set. */
  bubbleKey?: TranslationKey
  params?: Record<string, number | string>
  /** True while a run is still producing this Scene's reply: the bubble shows a typing indicator. */
  typing?: boolean
  hasRecoverEntry: boolean
  kind: CatFeedbackKind
}

export interface UseStudioCinemaCatFeedbackArgs {
  statusKey: TranslationKey
  statusParams?: Record<string, number | string>
  sessionId: string
  sceneId: string
  /** Status of the latest Run: a cancelled Run is not a failure, so it reports nothing. */
  latestRunStatus: string | null
  /** The newest assistant message of this Scene. The only thing the cat is allowed to say. */
  reply: { id: string; text: string } | null
  /** A run is in flight and no reply for it has arrived: the cat types instead of repeating itself. */
  pendingReply: boolean
}

export interface UseStudioCinemaCatFeedbackResult {
  bubble: CatBubble | null
  visible: boolean
  /** Pause the fade while the reader hovers or focuses the bubble (doc §7.2). */
  onHoverStart: () => void
  onHoverEnd: () => void
}

export function useStudioCinemaCatFeedback({
  statusKey,
  statusParams,
  sessionId,
  sceneId,
  latestRunStatus,
  reply,
  pendingReply,
}: UseStudioCinemaCatFeedbackArgs): UseStudioCinemaCatFeedbackResult {
  const [bubble, setBubble] = useState<CatBubble | null>(null)
  const [visible, setVisible] = useState(false)

  const identityRef = useRef(`${sessionId}\u0000${sceneId}`)
  const seenReplyRef = useRef<string | null>(null)
  const lastEmittedRef = useRef<string>('')
  const sourceRef = useRef<'report' | 'reply' | 'typing' | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedRef = useRef(false)

  const identity = `${sessionId}\u0000${sceneId}`
  const replyId = reply?.id ?? null
  const snippet = reply ? readStudioCinemaCatReplySnippet(reply.text) : ''
  // A cancel lands on the same status key as a failure but is not one: it reports nothing.
  const report =
    latestRunStatus === 'cancelled' && statusKey === 'studio.cinema.catFailed'
      ? null
      : readStudioCinemaCatFeedback(statusKey)
  const reportKey = report?.bubbleKey ?? null
  const reportKind = report?.kind ?? null
  const reportHasRecoverEntry = report?.hasRecoverEntry ?? false

  useLayoutEffect(() => {
    const sceneChanged = identity !== identityRef.current
    if (sceneChanged) {
      identityRef.current = identity
      // A fresh Scene starts clean: the reply it already carries is history, not news.
      seenReplyRef.current = replyId
      lastEmittedRef.current = ''
      sourceRef.current = null
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setVisible(false)
    }

    const scheduleFade = (delay: number | null) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (delay === null) {
        return
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (!pausedRef.current) {
          setVisible(false)
        }
      }, delay)
    }

    // 0) A run is in flight and this Scene has not answered for it yet: the cat types. Repeating the
    //    previous reply here would be the stale "instant answer", so it never does.
    if (pendingReply) {
      const typingKey = `${identity}\u0000typing\u0000${replyId ?? ''}`
      if (typingKey !== lastEmittedRef.current) {
        lastEmittedRef.current = typingKey
        sourceRef.current = 'typing'
        setBubble({ typing: true, hasRecoverEntry: false, kind: 'transient' })
        setVisible(true)
        // A task can run for a while: the typing bubble does not fade on a timer.
        scheduleFade(null)
      }
      return
    }

    // 1) A state the assistant cannot state itself (failure, reconnect, unreadable status).
    if (reportKey && reportKind) {
      const emitKey = `${identity}\u0000${reportKey}`
      if (emitKey !== lastEmittedRef.current) {
        lastEmittedRef.current = emitKey
        sourceRef.current = 'report'
        setBubble({
          bubbleKey: reportKey,
          params: statusParams,
          hasRecoverEntry: reportHasRecoverEntry,
          kind: reportKind,
        })
        setVisible(true)
        scheduleFade(reportKind === 'persistent' ? null : TRANSIENT_FADE_MS)
      }
      return
    }

    // 2) A report that has cleared never lingers: the state it described is gone. The same holds for
    //    the typing indicator once the run stopped producing this reply.
    if (sourceRef.current === 'report' || sourceRef.current === 'typing') {
      sourceRef.current = null
      lastEmittedRef.current = ''
      setVisible(false)
    }

    // 3) The cat repeats the opening of a reply it has not shown yet.
    if (replyId !== null && snippet !== '' && replyId !== seenReplyRef.current) {
      seenReplyRef.current = replyId
      sourceRef.current = 'reply'
      lastEmittedRef.current = `${identity}\u0000reply\u0000${replyId}`
      setBubble({ text: snippet, hasRecoverEntry: false, kind: 'transient' })
      setVisible(true)
      scheduleFade(TRANSIENT_FADE_MS)
    }
  }, [
    identity,
    statusKey,
    statusParams,
    reportKey,
    reportKind,
    reportHasRecoverEntry,
    replyId,
    snippet,
    pendingReply,
  ])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const onHoverStart = () => {
    pausedRef.current = true
  }
  const onHoverEnd = () => {
    pausedRef.current = false
    // If the fade already elapsed while paused, hide now; otherwise the running timer still fires.
    if (timerRef.current === null && bubble && bubble.kind !== 'persistent') {
      setVisible(false)
    }
  }

  return { bubble, visible, onHoverStart, onHoverEnd }
}
