import { useEffect, useRef, useState } from 'react'
import { localizeApiMessage } from '../../shared/i18n/runtime'
import { getConnectionHeaders, withConnectionProvider } from './connection-request'
import type { ConnectionSettings } from './connection-types'

export type ConnectionTestResult =
  | { status: 'idle' | 'testing' | 'success'; message?: string }
  | { status: 'error'; message: string; revoked: boolean }

export function useConnectionTest() {
  const [result, setResult] = useState<ConnectionTestResult>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const reset = () => {
    controller.current?.abort()
    controller.current = null
    setResult({ status: 'idle' })
  }
  const verify = async (connection: ConnectionSettings): Promise<boolean> => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setResult({ status: 'testing' })
    try {
      const response = await fetch('/api/access/verify', {
        method: 'POST',
        headers: getConnectionHeaders('application/json', connection),
        body: JSON.stringify(withConnectionProvider({}, connection)),
        signal: current.signal,
      })
      const payload = await response.json()
      if (!response.ok || payload.success !== true) {
        const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
        throw new Error(message)
      }
      if (current.signal.aborted) return false
      setResult({ status: 'success' })
      return true
    } catch (error) {
      if (current.signal.aborted) return false
      const message = error instanceof Error ? error.message : String(error)
      setResult({ status: 'error', message: localizeApiMessage(message), revoked: message.includes('该 CatKey 已被停用') })
      return false
    }
  }
  return { result, verify, reset }
}
