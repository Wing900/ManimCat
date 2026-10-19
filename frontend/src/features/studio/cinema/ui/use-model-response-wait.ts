import { useEffect, useState } from 'react'

const MODEL_RESPONSE_WAIT_MS = 60_000

/** Report silence without changing the Run's real status or interrupting it. */
export function useModelResponseWait(waiting: boolean, identity: string, progress: string): boolean {
  const key = `${identity}\u0000${progress}`
  const [silentKey, setSilentKey] = useState<string | null>(null)
  useEffect(() => {
    setSilentKey(null)
    if (!waiting) return
    const timer = window.setTimeout(() => setSilentKey(key), MODEL_RESPONSE_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [key, waiting])
  return waiting && silentKey === key
}
