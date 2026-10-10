import { useEffect, useRef, useState } from 'react'
import { localizeApiMessage, translate } from '../../shared/i18n/runtime'
import { getConnectionHeaders, withConnectionProvider } from './connection-request'
import type { ConnectionSettings } from './connection-types'

export type ConnectionTestResult =
  | { status: 'idle' | 'testing' | 'success'; message?: string }
  | { status: 'error'; message: string; revoked: boolean }

/**
 * Turns whatever came back into one sentence a person can act on.
 *
 * The body is not guaranteed to be ours: a gateway, a proxy or an outdated deploy answers with
 * HTML, and a raw parse error ("Unexpected token '<'") reads as a bug in this app rather than as
 * "the server does not know this route". Each of those gets its own wording.
 */
function describeFailure(message: string): string {
  if (message === 'HTTP 404') {
    return translate('connection.test.endpointMissing')
  }

  const status = /^HTTP (\d+)$/.exec(message)
  if (status) {
    return translate('connection.test.httpStatus', { status: status[1] })
  }

  if (/failed to fetch|network error|load failed/i.test(message)) {
    return translate('connection.test.networkError')
  }

  return localizeApiMessage(message)
}

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

      // Read as text first, then agree on a shape: `response.json()` on an HTML error page throws a
      // parse error, which would hide the status code that actually explains the failure.
      const raw = await response.text()
      let payload: { success?: unknown; error?: unknown } | null = null
      try {
        payload = raw ? JSON.parse(raw) : null
      } catch {
        payload = null
      }
      const serverError = typeof payload?.error === 'string' ? payload.error : null

      if (!response.ok || payload?.success !== true) {
        throw new Error(serverError ?? `HTTP ${response.status}`)
      }
      if (current.signal.aborted) return false
      setResult({ status: 'success' })
      return true
    } catch (error) {
      if (current.signal.aborted) return false
      const message = error instanceof Error ? error.message : String(error)
      setResult({
        status: 'error',
        message: describeFailure(message),
        revoked: message.includes('该 CatKey 已被停用'),
      })
      return false
    }
  }
  return { result, verify, reset }
}
