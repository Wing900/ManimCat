/**
 * Infrastructure-neutral boundary for cross-instance Studio event delivery.
 *
 * The Studio domain only knows `StudioEventBus`. This port is what a distributed bus uses
 * to leave the process: it deals in opaque serialized envelopes, so no Redis, ioredis,
 * channel or payload knowledge is required here. Implementations must be easy to fake in
 * tests.
 */
export interface StudioEventBrokerPort {
  /**
   * Subscribes to the transport and invokes `onMessage` for every raw envelope received
   * from other instances. Resolves once the subscription is established, and rejects when
   * it cannot be established (a configured distributed deployment must not silently fall
   * back to memory-only delivery).
   */
  start(onMessage: (serializedEnvelope: string) => void): Promise<void>

  /** Publishes one serialized envelope. Rejects on transport failure. */
  publish(serializedEnvelope: string): Promise<void>

  /** Idempotent teardown of the resources this broker owns. */
  close(): Promise<void>
}

/** Minimal logging surface; payloads are never logged. */
export interface StudioEventBrokerLogger {
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

/** Deployment-scoped channel name; every replica of one deployment shares it. */
export const STUDIO_EVENT_REDIS_CHANNEL_ENV = 'STUDIO_EVENT_REDIS_CHANNEL'

const STUDIO_EVENT_CHANNEL_MAX_LENGTH = 200

/**
 * Resolves the Pub/Sub channel: an explicit `STUDIO_EVENT_REDIS_CHANNEL` override when it
 * is a non-empty, whitespace-free, bounded string, otherwise the deployment default
 * `manimcat:<NODE_ENV>:studio-events`. Deployments sharing one Redis instance can select
 * different channels, and an invalid override fails fast instead of silently collapsing
 * two deployments onto one channel.
 */
export function resolveStudioEventChannel(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[STUDIO_EVENT_REDIS_CHANNEL_ENV]?.trim()
  if (override) {
    if (override.length > STUDIO_EVENT_CHANNEL_MAX_LENGTH || /\s/.test(override)) {
      throw new Error(
        `${STUDIO_EVENT_REDIS_CHANNEL_ENV} must be a channel name without whitespace (max ${STUDIO_EVENT_CHANNEL_MAX_LENGTH} characters)`
      )
    }
    return override
  }

  const environment = env.NODE_ENV?.trim() || 'development'
  return `manimcat:${environment}:studio-events`
}
