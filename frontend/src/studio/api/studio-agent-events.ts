import { getStudioApiBase, getStudioAuthHeaders } from './client'
import type { StudioExternalEvent } from '../protocol/studio-agent-events'

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

export interface StudioEventConnectionStatus {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  attempt: number
  error?: string
}

interface StudioEventSubscriptionOptions {
  signal: AbortSignal
  onEvent: (event: StudioExternalEvent) => void
  onStatusChange?: (status: StudioEventConnectionStatus) => void
}

export async function subscribeStudioEvents(options: StudioEventSubscriptionOptions): Promise<void> {
  let attempt = 0

  while (!options.signal.aborted) {
    options.onStatusChange?.({
      state: attempt === 0 ? 'connecting' : 'reconnecting',
      attempt,
    })

    try {
      await consumeStudioEventStream(options)
      if (!options.signal.aborted) {
        attempt += 1
      }
    } catch (error) {
      if (options.signal.aborted) {
        return
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

async function consumeStudioEventStream(options: StudioEventSubscriptionOptions): Promise<void> {
  const response = await fetch(`${getStudioApiBase()}/events`, {
    headers: {
      Accept: 'text/event-stream',
      ...getStudioAuthHeaders(),
    },
    signal: options.signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`Studio event stream failed (${response.status})`)
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
  } catch {
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
