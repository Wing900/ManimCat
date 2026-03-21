import { startTransition, useEffect, useEffectEvent } from 'react'
import { subscribeStudioEvents } from '../api/studio-agent-events'
import type { StudioExternalEvent } from '../protocol/studio-agent-events'

interface UseStudioEventsInput {
  sessionId: string | null
  onEvent: (event: StudioExternalEvent) => void
  onStatusChange: (status: { state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'; error?: string }) => void
}

export function useStudioEvents({ sessionId, onEvent, onStatusChange }: UseStudioEventsInput) {
  const handleEvent = useEffectEvent(onEvent)
  const handleStatusChange = useEffectEvent(onStatusChange)

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const controller = new AbortController()

    void subscribeStudioEvents({
      signal: controller.signal,
      onEvent: (event) => {
        const eventSessionId = resolveEventSessionId(event)
        if (eventSessionId && eventSessionId !== sessionId) {
          return
        }

        startTransition(() => {
          handleEvent(event)
        })
      },
      onStatusChange: (status) => {
        handleStatusChange({
          state: status.state,
          error: status.error,
        })
      },
    }).catch((error) => {
      if (controller.signal.aborted) {
        return
      }

      handleStatusChange({
        state: 'disconnected',
        error: error instanceof Error ? error.message : String(error),
      })
    })

    return () => controller.abort()
  }, [sessionId])
}

function resolveEventSessionId(event: StudioExternalEvent): string | null {
  switch (event.type) {
    case 'task.updated':
    case 'work.updated':
    case 'work-result.updated':
    case 'assistant.text':
    case 'question.requested':
      return event.properties.sessionId
    case 'permission.asked':
    case 'permission.replied':
      return event.properties.sessionID
    case 'run.updated':
      return event.properties.run.sessionId
    case 'studio.connected':
    case 'studio.heartbeat':
      return null
    default:
      return null
  }
}
