import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Keeps the previous value on stage for `exitMs` after `key` changes, so it can animate out while the
 * new one animates in — the two-card push (doc §3.1): a replaced card never just disappears.
 *
 * The timer lives in a ref, not in the effect's cleanup, because the effect re-runs on every live
 * update of `value`; a cleanup-based timer would be cancelled by any unrelated render and the leaving
 * card would never go away.
 */
export function useExitingLayer<TValue>(key: string, value: TValue, exitMs: number): TValue | null {
  const [exiting, setExiting] = useState<TValue | null>(null)
  const currentRef = useRef<{ key: string; value: TValue } | null>(null)
  const timerRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const previous = currentRef.current
    currentRef.current = { key, value }
    if (!previous || previous.key === key) {
      return
    }
    setExiting(previous.value)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setExiting(null)
    }, exitMs)
  }, [key, value, exitMs])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return exiting
}
