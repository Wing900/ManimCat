import { useEffect, useState } from 'react'

/**
 * Keeps a node mounted while its exit animation plays, so closing an overlay can slide out instead of
 * vanishing.
 *
 * `mounted` stays true from the moment an overlay opens until `exitMs` after it closes. While it is
 * exiting the node is no longer interactive: callers drop its live role, mark it `aria-hidden` and
 * `inert`, so a screen reader and a test both see it as gone the instant it closed — only the pixels
 * linger for the length of the animation.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean } {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs])

  return { mounted: mounted || open }
}
