import type Redis from 'ioredis'
import { redisClient } from '../../config/redis'
import { createLogger } from '../../utils/logger'
import {
  resolveStudioEventChannel,
  type StudioEventBrokerLogger,
  type StudioEventBrokerPort
} from './studio-event-broker'

export interface CreateRedisStudioEventBrokerOptions {
  /** Shared publisher; the adapter never closes it. Defaults to the shared client. */
  publisher?: Redis
  /** Injectable subscriber. Once provided it is owned by this adapter, like the duplicate. */
  subscriber?: Redis
  /** Deployment-scoped channel; defaults to `resolveStudioEventChannel()`. */
  channel?: string
  logger?: StudioEventBrokerLogger
}

/**
 * Redis Pub/Sub implementation of `StudioEventBrokerPort`.
 *
 * This is the only Studio module that knows about Redis. It publishes on the shared client
 * and subscribes on a dedicated duplicate (a connection in subscribe mode cannot publish),
 * owns only that duplicate, and uses one deployment-scoped channel rather than one
 * connection per Studio session.
 */
export function createRedisStudioEventBroker(
  options: CreateRedisStudioEventBrokerOptions = {}
): StudioEventBrokerPort {
  const publisher = options.publisher ?? redisClient
  const channel = options.channel ?? resolveStudioEventChannel()
  const logger = options.logger ?? createLogger('StudioEventBroker')

  let subscriber: Redis | null = options.subscriber ?? null
  let started = false
  let closePromise: Promise<void> | null = null

  function ensureSubscriber(): Redis {
    if (subscriber) {
      return subscriber
    }
    const created = publisher.duplicate()
    // Attach handlers immediately: an unhandled 'error' event would crash the process.
    created.on('error', (error: Error) => {
      logger.error('Studio event subscriber error', { message: error.message })
    })
    created.on('reconnecting', () => {
      logger.warn('Studio event subscriber reconnecting')
    })
    subscriber = created
    return created
  }

  async function closeSubscriber(): Promise<void> {
    const client = subscriber
    subscriber = null
    if (!client) {
      return
    }
    client.removeAllListeners('message')
    if (client.status === 'ready') {
      try {
        await client.quit()
        return
      } catch {
        // Fall through to a hard disconnect.
      }
    }
    client.disconnect()
  }

  return {
    async start(onMessage: (serializedEnvelope: string) => void): Promise<void> {
      if (closePromise) {
        throw new Error('Studio event broker is closed')
      }
      if (started) {
        return
      }
      const client = ensureSubscriber()
      client.on('message', (receivedChannel: string, payload: string) => {
        if (receivedChannel === channel) {
          onMessage(payload)
        }
      })

      // Rejects when the initial subscription cannot be established, so a distributed
      // deployment fails startup instead of silently degrading to memory-only delivery.
      await client.subscribe(channel)
      started = true
      logger.info('Studio event broker subscribed', { channel })
    },

    async publish(serializedEnvelope: string): Promise<void> {
      await publisher.publish(channel, serializedEnvelope)
    },

    async close(): Promise<void> {
      closePromise ??= (async () => {
        await closeSubscriber()
        logger.info('Studio event broker closed')
      })()
      return closePromise
    }
  }
}
