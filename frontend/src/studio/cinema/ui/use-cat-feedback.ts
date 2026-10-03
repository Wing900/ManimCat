import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import {
  readStudioCinemaCatFeedback,
  readStudioCinemaCatTransition,
  type CatFeedbackKind,
} from './cat-feedback'

/**
 * Cat feedback timing and isolation (doc §7.1, §7.2).
 *
 * - scene/session switch clears the bubble immediately, so a delayed event from another Scene never
 *   lands here;
 * - a transient bubble fades after a few seconds; a persistent one (failure, reconnect, needs-check)
 *   stays until the state changes; a resting one fades fast;
 * - hover or focus pauses the fade;
 * - the same status does not re-pop the same bubble (dedup by identity + status key);
 * - a reliable working → idle transition shows "done" once, and the initial load (previous = null)
 *   never announces "done".
 *
 * All ref bookkeeping and state mutation happen in a `useLayoutEffect` (the same pattern
 * `SceneHistoryPanel` uses for its reading-position bookkeeping), so the render stays pure.
 */

const TRANSIENT_FADE_MS = 5000
const RESTING_FADE_MS = 3000

export interface CatBubble {
  bubbleKey: TranslationKey
  params: Record<string, number | string> | undefined
  hasRecoverEntry: boolean
  kind: CatFeedbackKind
}

export interface UseStudioCinemaCatFeedbackArgs {
  statusKey: TranslationKey
  statusParams?: Record<string, number | string>
  sessionId: string
  sceneId: string
  hasFailedOutcome: boolean
  /** Status of the latest Run, to distinguish a cancel from a failure (doc §7.2). */
  latestRunStatus: string | null
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
  hasFailedOutcome,
  latestRunStatus,
}: UseStudioCinemaCatFeedbackArgs): UseStudioCinemaCatFeedbackResult {
  const [bubble, setBubble] = useState<CatBubble | null>(null)
  const [visible, setVisible] = useState(false)

  const identityRef = useRef(`${sessionId}\u0000${sceneId}`)
  const prevStatusRef = useRef<TranslationKey | null>(null)
  const lastEmittedRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedRef = useRef(false)

  const identity = `${sessionId}\u0000${sceneId}`

  useLayoutEffect(() => {
    const sceneChanged = identity !== identityRef.current
    if (sceneChanged) {
      // A fresh Scene starts clean: no inherited previous, no fade timer. The bubble itself is
      // re-emitted below for the new Scene's current status, so no separate reset is needed.
      identityRef.current = identity
      prevStatusRef.current = null
      lastEmittedRef.current = ''
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const previous = prevStatusRef.current
    prevStatusRef.current = statusKey

    // A reliable working → idle transition shows "done" once. The initial load (previous === null)
    // never announces done, so opening a Scene with history does not replay it.
    const transition = readStudioCinemaCatTransition(
      previous,
      statusKey,
      hasFailedOutcome,
      latestRunStatus === 'cancelled',
    )
    if (transition) {
      const emitKey = `${identity}\u0000${transition.bubbleKey}`
      if (emitKey !== lastEmittedRef.current) {
        lastEmittedRef.current = emitKey
        setBubble({
          bubbleKey: transition.bubbleKey,
          params: statusParams,
          hasRecoverEntry: false,
          kind: transition.kind,
        })
        setVisible(true)
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        const delay = TRANSIENT_FADE_MS
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          if (!pausedRef.current) {
            setVisible(false)
          }
        }, delay)
        return
      }
    }

    const feedback = readStudioCinemaCatFeedback(statusKey)
    const emitKey = `${identity}\u0000${statusKey}`
    // Dedup: the same status for the same identity does not re-pop the same bubble.
    if (emitKey === lastEmittedRef.current) {
      return
    }
    lastEmittedRef.current = emitKey
    setBubble({
      bubbleKey: feedback.bubbleKey,
      params: statusParams,
      hasRecoverEntry: feedback.hasRecoverEntry,
      kind: feedback.kind,
    })
    setVisible(true)
    // Inline fade scheduling so ref mutation stays inside the effect that owns the timer.
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (feedback.kind !== 'persistent') {
      const delay = feedback.kind === 'resting' ? RESTING_FADE_MS : TRANSIENT_FADE_MS
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (!pausedRef.current) {
          setVisible(false)
        }
      }, delay)
    }
  }, [identity, statusKey, statusParams, hasFailedOutcome, latestRunStatus])

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