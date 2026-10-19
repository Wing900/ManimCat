import { getStudioApiBase, getStudioAuthHeaders, StudioApiRequestError } from './client'
import type { StudioExternalEvent } from '../protocol/studio-agent-events'

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

export interface StudioEventConnectionStatus {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  attempt: number
  error?: string
}

/**
 * Stream scope. `session` keeps the existing Session stream endpoint byte-for-byte; `scene`
 * selects the nested Scene stream, which the backend already filters to that exact Scene.
 */
export type StudioEventStreamScope =
  | { kind: 'session'; sessionId: string }
  | { kind: 'scene'; sessionId: string; sceneId: string }

interface StudioEventSubscriptionBase {
  signal: AbortSignal
  onEvent: (event: StudioExternalEvent) => void
  onStatusChange?: (status: StudioEventConnectionStatus) => void
  /** Resolve identity and frame projection together for each connection, including reconnects. */
  resolveConnection?: () => Promise<{
    scope: StudioEventStreamScope
    onEvent: (event: StudioExternalEvent) => void
  }>
  onNotFound?: (scope: StudioEventStreamScope) => Promise<void>
}

/**
 * Subscription options. Identity comes from exactly one place: either the legacy `sessionId` or a
 * structured `scope`, so a Session id and a Scene scope can never disagree.
 */
export type StudioEventSubscriptionOptions = StudioEventSubscriptionBase &
  ({ sessionId: string; scope?: undefined } | { scope: StudioEventStreamScope })

/** Resolves the one scope a subscription talks to. */
export function resolveStudioEventStreamScope(
  options: StudioEventSubscriptionOptions,
): StudioEventStreamScope {
  return options.scope ?? { kind: 'session', sessionId: options.sessionId }
}

/**
 * Stream URL for one scope. The Session form is exactly the pre-Scene URL; the Scene form nests
 * under the same Session endpoint and encodes both identifiers.
 */
export function buildStudioEventStreamUrl(scope: StudioEventStreamScope): string {
  const sessionPath = `${getStudioApiBase()}/sessions/${encodeURIComponent(scope.sessionId)}`
  return scope.kind === 'scene'
    ? `${sessionPath}/scenes/${encodeURIComponent(scope.sceneId)}/events`
    : `${sessionPath}/events`
}

export async function subscribeStudioEvents(options: StudioEventSubscriptionOptions): Promise<void> {
  let attempt = 0
  const requestedScope = resolveStudioEventStreamScope(options)

  while (!options.signal.aborted) {
    options.onStatusChange?.({
      state: attempt === 0 ? 'connecting' : 'reconnecting',
      attempt,
    })

    let scope = requestedScope
    let connectionResolved = false
    try {
      const connection = options.resolveConnection ? await options.resolveConnection() : null
      if (options.signal.aborted) return
      scope = connection?.scope ?? requestedScope
      connectionResolved = true
      await consumeStudioEventStream({ ...options, onEvent: connection?.onEvent ?? options.onEvent }, scope)
      if (!options.signal.aborted) {
        attempt += 1
      }
    } catch (error) {
      if (options.signal.aborted) {
        return
      }

      if (!connectionResolved && error instanceof StudioApiRequestError && error.code === 'NOT_FOUND') {
        throw error
      }
      if (connectionResolved && error instanceof StudioApiRequestError && error.code === 'NOT_FOUND' && options.onNotFound) {
        await options.onNotFound(scope)
        if (options.signal.aborted) return
      }

      options.onStatusChange?.({
        state: 'reconnecting',
        attempt,
        error: error instanceof Error ? error.message : String(error),
      })
      attempt += 1
    }

    const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
    await wait(delay, options.signal)
  }
}

async function consumeStudioEventStream(
  options: StudioEventSubscriptionBase,
  scope: StudioEventStreamScope,
): Promise<void> {
  const response = await fetch(buildStudioEventStreamUrl(scope), {
    headers: {
      Accept: 'text/event-stream',
      ...getStudioAuthHeaders(),
    },
    signal: options.signal,
  })

  if (!response.ok || !response.body) {
    throw new StudioApiRequestError(
      `Studio event stream failed (${response.status})`,
      response.status === 404 ? 'NOT_FOUND' : 'STUDIO_STREAM_FAILED',
    )
  }

  options.onStatusChange?.({ state: 'connected', attempt: 0 })

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  while (!options.signal.aborted) {
    const chunk = await reader.read()
    if (chunk.done) {
      throw new Error('Studio event stream closed')
    }

    buffer += chunk.value
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const event = parseSseBlock(block)
      if (event) {
        options.onEvent(event)
      }
    }
  }
}

function parseSseBlock(block: string): StudioExternalEvent | null {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())

  if (!dataLines.length) {
    return null
  }

  try {
    return JSON.parse(dataLines.join('\n')) as StudioExternalEvent
  } catch (error) {
    console.error('[Studio events] Could not parse SSE data', {
      data: dataLines.join('\n'),
      error,
    })
    return null
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const cleanup = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}
