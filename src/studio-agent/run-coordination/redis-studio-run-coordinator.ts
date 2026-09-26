import type Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { redisClient } from '../../config/redis'
import { createLogger } from '../../utils/logger'
import {
  createStudioRunOwnerInstanceId,
  resolveStudioRunCancellationTtlMs,
  resolveStudioRunControlChannel,
  resolveStudioRunLeaseTtlMs,
  resolveStudioRunRedisPrefix,
  type StudioRunCancellationCommand,
  type StudioRunCancellationListener,
  type StudioRunCoordinationLogger,
  type StudioRunCoordinatorPort,
  type StudioRunLease
} from './studio-run-coordinator'
import {
  assertStudioRunCancellationMarkerWritten,
  createStudioRunCancellationCommand,
  decodeStudioRunCancellationCommand,
  encodeStudioRunCancellationCommand,
  encodeStudioRunKeySegment
} from './studio-run-cancellation-codec'

/** Compare-and-expire: another replica's lease is never extended. */
const RENEW_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`

/** Compare-and-delete: another replica's lease is never released. */
const RELEASE_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export interface CreateRedisStudioRunCoordinatorOptions {
  /** Shared command/publish client; the adapter never closes it. Defaults to the shared client. */
  publisher?: Redis
  /** Injectable subscriber. Once provided it is owned by this adapter, like the duplicate. */
  subscriber?: Redis
  prefix?: string
  controlChannel?: string
  leaseTtlMs?: number
  cancellationTtlMs?: number
  /** Injectable for deterministic specs; defaults to a stable per-process id. */
  ownerInstanceId?: string
  logger?: StudioRunCoordinationLogger
}

/**
 * Redis implementation of `StudioRunCoordinatorPort`.
 *
 * This is the only Run coordination module that knows about Redis. Leases use `SET NX PX`
 * plus Lua compare-and-act scripts so a replica can never renew or delete a lease it does
 * not own; cancellations write a durable marker and publish on a private control channel
 * that is deliberately separate from the public Studio event channel (`studio-event-broker`).
 */
export function createRedisStudioRunCoordinator(
  options: CreateRedisStudioRunCoordinatorOptions = {}
): StudioRunCoordinatorPort {
  const publisher = options.publisher ?? redisClient
  const prefix = normalizePrefix(options.prefix ?? resolveStudioRunRedisPrefix())
  const controlChannel = options.controlChannel ?? resolveStudioRunControlChannel()
  const leaseTtlMs = options.leaseTtlMs ?? resolveStudioRunLeaseTtlMs()
  const cancellationTtlMs = options.cancellationTtlMs ?? resolveStudioRunCancellationTtlMs()
  const ownerInstanceId = options.ownerInstanceId ?? createStudioRunOwnerInstanceId()
  const logger = options.logger ?? createLogger('StudioRunCoordinator')

  let subscriber: Redis | null = options.subscriber ?? null
  let started = false
  let closePromise: Promise<void> | null = null

  function leaseKey(sessionId: string): string {
    return `${prefix}:lease:${encodeStudioRunKeySegment(sessionId)}`
  }

  function cancellationKey(runId: string): string {
    return `${prefix}:cancel:${encodeStudioRunKeySegment(runId)}`
  }

  function serializeLeaseValue(lease: StudioRunLease): string {
    // Ordered array so the token comparison never depends on object key ordering.
    return JSON.stringify([lease.ownerInstanceId, lease.leaseId])
  }

  function ensureSubscriber(): Redis {
    if (subscriber) {
      return subscriber
    }
    const created = publisher.duplicate()
    // Attach handlers immediately: an unhandled 'error' event would crash the process.
    created.on('error', (error: Error) => {
      logger.error('Studio Run control subscriber error', { message: error.message })
    })
    created.on('reconnecting', () => {
      logger.warn('Studio Run control subscriber reconnecting')
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
    async start(onCancellation: StudioRunCancellationListener): Promise<void> {
      if (closePromise) {
        throw new Error('Studio Run coordinator is closed')
      }
      if (started) {
        return
      }
      const client = ensureSubscriber()
      client.on('message', (receivedChannel: string, payload: string) => {
        if (receivedChannel !== controlChannel) {
          return
        }
        const decoded = decodeStudioRunCancellationCommand(payload)
        if (!decoded.ok) {
          logger.warn('Ignoring invalid Studio Run cancellation command', decoded.reason)
          return
        }
        try {
          onCancellation(decoded.command)
        } catch (error) {
          logger.error('Studio Run cancellation listener failed', messageOf(error))
        }
      })

      // Rejects when the initial subscription cannot be established, so a distributed
      // deployment fails startup instead of running un-cancellable.
      await client.subscribe(controlChannel)
      started = true
      logger.info('Studio Run coordinator subscribed', { channel: controlChannel })
    },

    async tryAcquireSession(sessionId: string): Promise<StudioRunLease | null> {
      if (closePromise) {
        throw new Error('Studio Run coordinator is closed')
      }
      const lease: StudioRunLease = {
        sessionId,
        leaseId: randomUUID(),
        ownerInstanceId,
        expiresAt: Date.now() + leaseTtlMs
      }
      const reply = await publisher.set(leaseKey(sessionId), serializeLeaseValue(lease), 'PX', leaseTtlMs, 'NX')
      // `null` means another replica holds the session; anything else is not a conflict, so
      // it is treated as a coordination failure rather than a silent admission.
      if (reply === null) {
        return null
      }
      if (reply !== 'OK') {
        throw new Error('Studio Run lease acquisition returned an unexpected reply')
      }
      return lease
    },

    async renewSession(lease: StudioRunLease): Promise<StudioRunLease | null> {
      const result = await publisher.eval(
        RENEW_LEASE_SCRIPT,
        1,
        leaseKey(lease.sessionId),
        serializeLeaseValue(lease),
        String(leaseTtlMs)
      )
      if (Number(result) !== 1) {
        return null
      }
      return { ...lease, expiresAt: Date.now() + leaseTtlMs }
    },

    async releaseSession(lease: StudioRunLease): Promise<boolean> {
      const result = await publisher.eval(RELEASE_LEASE_SCRIPT, 1, leaseKey(lease.sessionId), serializeLeaseValue(lease))
      return Number(result) === 1
    },

    async requestCancellation(runId: string, reason: string): Promise<StudioRunCancellationCommand> {
      if (closePromise) {
        throw new Error('Studio Run coordinator is closed')
      }
      const command = createStudioRunCancellationCommand({ runId, reason })
      const payload = encodeStudioRunCancellationCommand(command)

      // One round trip. The marker is the recovery path and must be durably recorded before a
      // cancellation may be claimed; the publish is the latency optimization only, so a
      // publish failure is logged and stays recoverable.
      const results = await publisher
        .pipeline()
        .set(cancellationKey(runId), payload, 'PX', cancellationTtlMs)
        .publish(controlChannel, payload)
        .exec()

      // A missing pipeline result, a command error, or any reply other than `OK` means the
      // marker is not durable: the caller reports coordination unavailable instead of success.
      assertStudioRunCancellationMarkerWritten(results?.[0])
      const publishResult = results?.[1]
      if (publishResult?.[0]) {
        logger.warn('Studio Run cancellation publish failed', { message: messageOf(publishResult[0]) })
      }
      return command
    },

    async readCancellation(runId: string): Promise<StudioRunCancellationCommand | null> {
      const raw = await publisher.get(cancellationKey(runId))
      if (raw === null) {
        return null
      }
      const decoded = decodeStudioRunCancellationCommand(raw)
      if (!decoded.ok) {
        logger.warn('Ignoring invalid Studio Run cancellation marker', decoded.reason)
        return null
      }
      if (decoded.command.runId !== runId) {
        // The key and the payload must agree, otherwise a marker could cancel another Run.
        // No payload content is logged: the fixed message is the whole rejection reason.
        logger.warn('Ignoring Studio Run cancellation marker that does not match its key')
        return null
      }
      return decoded.command
    },

    async close(): Promise<void> {
      closePromise ??= (async () => {
        await closeSubscriber()
        logger.info('Studio Run coordinator closed')
      })()
      return closePromise
    }
  }
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/:+$/, '')
  if (!normalized) {
    throw new Error('Studio Run Redis prefix must not be empty')
  }
  return normalized
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
