import type { StudioEventBusRuntime } from '../events/create-default-studio-event-bus'
import type { StudioRunCoordinationRuntime } from './create-default-studio-run-coordination'

export interface StudioInfrastructureRuntimeLogger {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

export interface StudioInfrastructureRuntime {
  event: StudioEventBusRuntime
  runCoordination: StudioRunCoordinationRuntime
  start(): Promise<void>
  close(): Promise<void>
}

const NOOP_LOGGER: StudioInfrastructureRuntimeLogger = {
  info() {},
  warn() {},
  error() {}
}

/**
 * One named aggregate lifecycle for the Studio infrastructure that must be up before HTTP and
 * down after it: cross-replica event delivery and Run coordination. Keeping them in one place
 * avoids a growing chain of unrelated global start/close calls in `server.ts`.
 *
 * Order, exactly:
 *
 * - start: event transport, then Run coordination (coordination publishes events during
 *   stale-Run reconciliation, so the transport must already be subscribed);
 * - close: Run coordination, then the event transport (shutdown first relinquishes Run
 *   ownership, then stops delivery).
 *
 * Callers continue after `close()` with the queue and the shared Redis client.
 */
export function createStudioInfrastructureRuntime(input: {
  event: StudioEventBusRuntime
  runCoordination: StudioRunCoordinationRuntime
  logger?: StudioInfrastructureRuntimeLogger
}): StudioInfrastructureRuntime {
  const logger = input.logger ?? NOOP_LOGGER
  let startPromise: Promise<void> | null = null
  let closePromise: Promise<void> | null = null

  return {
    event: input.event,
    runCoordination: input.runCoordination,

    start(): Promise<void> {
      startPromise ??= startInfrastructure()
      return startPromise
    },

    close(): Promise<void> {
      closePromise ??= closeInfrastructure()
      return closePromise
    }
  }

  async function startInfrastructure(): Promise<void> {
    await input.event.start()
    try {
      await input.runCoordination.start()
    } catch (error) {
      // Roll back the component that already started, then report the failure.
      try {
        await input.event.close()
      } catch (closeError) {
        logger.warn('Failed to roll back the Studio event transport after a coordination startup failure', {
          message: messageOf(closeError)
        })
      }
      throw error
    }
  }

  async function closeInfrastructure(): Promise<void> {
    try {
      await input.runCoordination.close()
    } catch (error) {
      logger.warn('Failed to close Studio Run coordination', { message: messageOf(error) })
    }
    try {
      await input.event.close()
    } catch (error) {
      logger.warn('Failed to close the Studio event transport', { message: messageOf(error) })
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
