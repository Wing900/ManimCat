import type { Request, Response } from 'express'
import type { StudioAgentEvent } from '../../studio-agent/domain/types'
import type { StudioExternalEvent } from '../../studio-agent/events/studio-event-adapter'
import { logPlotStudioTiming, logTimeline } from '../../studio-agent/observability/plot-studio-timing'

/**
 * Shared Server-Sent Events lifecycle for the Studio event streams.
 *
 * Authorization, Session/Scene lookup and the 404 shape stay in the route: this helper only owns
 * the transport (headers, heartbeat, connected frame, one subscription, one teardown). Both the
 * Session stream and the Scene stream therefore keep identical headers, heartbeat interval, retry
 * behavior and cleanup, while the Scene stream adds a domain-event filter.
 *
 * Lifecycle contract:
 * - the disconnect handlers are installed before any resource is allocated, so an abort during
 *   setup still tears the stream down;
 * - there is exactly one idempotent `teardown`, so a partial setup failure, a repeated close, a
 *   response error, a heartbeat write failure and an event write failure all release the same
 *   resources, and the subscription obtained is unsubscribed exactly once;
 * - projection, JSON encoding and the frame writes of a delivered event share one failure boundary,
 *   so a throwing serializer or encoder tears the stream down instead of escaping into the Event
 *   Bus publisher with a live timer and subscription;
 * - once the SSE headers are out, a failure never attempts a JSON error response: the stream ends
 *   and a sanitized line is logged.
 */

/** Heartbeat period shared by every Studio event stream. */
export const STUDIO_EVENT_STREAM_HEARTBEAT_MS = 15000

/**
 * Timer adapter. The default uses the real event loop; a specification injects a fake scheduler so
 * the lifecycle can be driven without a real sleep or a listening port.
 */
export interface StudioEventStreamClock {
  setInterval: (handler: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  now: () => number
}

const defaultClock: StudioEventStreamClock = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  now: () => Date.now()
}

export interface StudioEventStreamInput {
  req: Request
  res: Response
  /** Session whose events are delivered; the Event Bus subscription key. */
  sessionId: string
  /** Selected Scene for a Scene stream; absent for the Legacy Session stream. */
  sceneId?: string
  /** Delivery port of the Studio runtime, already authorized by the caller. */
  subscribeExternalEvents: (
    sessionId: string,
    listener: (event: StudioExternalEvent) => void,
    options?: { filter?: (event: StudioAgentEvent) => boolean }
  ) => () => void
  /** Domain-event predicate for a scoped stream; absent delivers every Session event. */
  filter?: (event: StudioAgentEvent) => boolean
  /** Public serialization of one event; defaults to the Session-level sanitizer. */
  serializeEvent: (event: StudioExternalEvent) => StudioExternalEvent
  /** Injectable timer adapter; defaults to the real event loop. */
  clock?: StudioEventStreamClock
}

export function openStudioAgentEventStream(input: StudioEventStreamInput): void {
  const { req, res, sessionId, sceneId } = input
  const clock = input.clock ?? defaultClock
  const logContext = { sessionId: sessionId ?? null, ...(sceneId ? { sceneId } : {}) }

  let heartbeatHandle: unknown
  let unsubscribe: (() => void) | undefined
  let closed = false
  let connectedFrameSent = false

  /** Releases one subscription; a throwing release is logged, never propagated. */
  const releaseSubscription = (release: () => void): void => {
    try {
      release()
    } catch (error) {
      logPlotStudioTiming('plot', 'events.stream.unsubscribe_failed', {
        ...logContext,
        reason: sanitizeReason(error)
      }, 'warn')
    }
  }

  /** The single teardown of this stream; safe to call from any failure path, idempotent. */
  const teardown = (): void => {
    if (closed) {
      return
    }
    closed = true

    if (heartbeatHandle !== undefined) {
      clock.clearInterval(heartbeatHandle)
      heartbeatHandle = undefined
    }

    const release = unsubscribe
    unsubscribe = undefined
    if (release) {
      releaseSubscription(release)
    }

    logPlotStudioTiming('plot', 'events.client.disconnected', logContext)
    logTimeline('plot', 'sse.disconnected')

    try {
      res.end()
    } catch {
      // The response is already gone; there is nothing left to release.
    }
  }

  // Handlers first: a request aborted during setup must not leak a timer or a subscription.
  req.on('close', teardown)
  req.on('aborted', teardown)
  res.on?.('close', teardown)
  res.on?.('error', teardown)

  /**
   * Writes one SSE frame. Projection, JSON encoding and both writes live inside this single failure
   * boundary: a throwing `serializeEvent` or a `JSON.stringify` failure is handled exactly like a
   * failed write, so neither can escape into the Event Bus publisher while the timer and the
   * subscription stay alive.
   */
  const writeFrame = (
    build: () => { eventName: string; payload: unknown },
    failureLog: string
  ): boolean => {
    try {
      const { eventName, payload } = build()
      res.write(`event: ${eventName}\n`)
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
      return true
    } catch (error) {
      logPlotStudioTiming('plot', failureLog, { ...logContext, reason: sanitizeReason(error) }, 'warn')
      teardown()
      return false
    }
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    logPlotStudioTiming('plot', 'events.client.connected', logContext)
    logTimeline('plot', 'sse.connected')

    heartbeatHandle = clock.setInterval(() => {
      if (closed) {
        return
      }
      writeFrame(
        () => ({
          eventName: 'studio.heartbeat',
          payload: { type: 'studio.heartbeat', properties: { timestamp: clock.now() } }
        }),
        'events.stream.heartbeat_failed'
      )
    }, STUDIO_EVENT_STREAM_HEARTBEAT_MS)

    const subscription = input.subscribeExternalEvents(
      sessionId,
      (event) => {
        if (closed) {
          return
        }
        writeFrame(
          () => ({ eventName: event.type, payload: input.serializeEvent(event) }),
          'events.stream.write_failed'
        )
      },
      input.filter ? { filter: input.filter } : undefined
    )

    if (closed) {
      // The bus delivered synchronously and that delivery failed before the subscription was
      // returned, so the teardown above ran with nothing to release. Release it now — exactly once,
      // because it is never stored — and never announce a stream that is already closed.
      releaseSubscription(subscription)
      return
    }
    unsubscribe = subscription

    connectedFrameSent = writeFrame(
      () => ({
        eventName: 'studio.connected',
        payload: { type: 'studio.connected', properties: { timestamp: clock.now() } }
      }),
      'events.stream.connected_frame_failed'
    )
    if (!connectedFrameSent) {
      return
    }
  } catch (error) {
    // Setup failed before the protocol was established: the caller's status line may still be
    // writable, so the route keeps responsibility for any JSON error and this helper only releases.
    logPlotStudioTiming('plot', 'events.stream.setup_failed', { ...logContext, reason: sanitizeReason(error) }, 'warn')
    teardown()
  }
}

/** Short, path-free failure reason: the log never carries a stack or a user value. */
function sanitizeReason(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name
  }
  return 'unknown_error'
}
