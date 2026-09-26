import { createLogger } from '../../utils/logger'
import type { StudioEventBus } from '../domain/types'
import { DistributedStudioEventBus } from './distributed-studio-event-bus'
import { InMemoryStudioEventBus } from './event-bus'
import {
  resolveStudioEventChannel,
  type StudioEventBrokerLogger,
  type StudioEventBrokerPort
} from './studio-event-broker'

export type StudioEventTransport = 'memory' | 'redis'

/**
 * Production event-bus composition: the domain bus plus its explicit lifecycle, so startup
 * and shutdown ordering stays visible instead of hiding behind casts.
 */
export interface StudioEventBusRuntime {
  eventBus: StudioEventBus
  transport: StudioEventTransport
  start(): Promise<void>
  close(): Promise<void>
}

export interface CreateDefaultStudioEventBusOptions {
  env?: NodeJS.ProcessEnv
  /**
   * Broker factory. Production injects the Redis adapter; keeping it injected means this
   * module (and therefore any test importing it) never pulls in the shared Redis client.
   */
  createBroker?: (input: { channel: string }) => StudioEventBrokerPort
  logger?: StudioEventBrokerLogger
}

export const STUDIO_EVENT_TRANSPORT_ENV = 'STUDIO_EVENT_TRANSPORT'

/**
 * `redis` is the production default; `memory` is the explicit single-instance fallback and
 * the default under `NODE_ENV=test`. Unknown values fail fast rather than guessing.
 */
export function resolveStudioEventTransport(env: NodeJS.ProcessEnv = process.env): StudioEventTransport {
  const raw = env[STUDIO_EVENT_TRANSPORT_ENV]?.trim().toLowerCase()
  if (!raw) {
    return env.NODE_ENV?.trim() === 'test' ? 'memory' : 'redis'
  }
  if (raw === 'memory' || raw === 'redis') {
    return raw
  }
  throw new Error(`${STUDIO_EVENT_TRANSPORT_ENV} must be either "redis" or "memory"`)
}

export function createDefaultStudioEventBus(
  options: CreateDefaultStudioEventBusOptions = {}
): StudioEventBusRuntime {
  const env = options.env ?? process.env
  const logger = options.logger ?? createLogger('StudioEventBus')
  const transport = resolveStudioEventTransport(env)

  if (transport === 'memory') {
    logger.warn(
      'Studio event transport is "memory": events reach only SSE clients connected to this process (single-instance mode)'
    )
    return {
      eventBus: new InMemoryStudioEventBus(),
      transport,
      start: () => Promise.resolve(),
      close: () => Promise.resolve()
    }
  }

  const channel = resolveStudioEventChannel(env)
  if (!options.createBroker) {
    throw new Error('Studio Redis event transport requires a broker factory')
  }

  const eventBus = new DistributedStudioEventBus({
    broker: options.createBroker({ channel }),
    logger
  })

  return {
    eventBus,
    transport,
    start: () => eventBus.start(),
    close: () => eventBus.close()
  }
}
