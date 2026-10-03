import type Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { redisClient } from '../../config/redis'
import { createLogger } from '../../utils/logger'
import {
  STUDIO_RUN_ADMISSION_NAMESPACE,
  canonicalStudioRunScopeKey,
  createStudioRunOwnerInstanceId,
  resolveStudioRunCancellationTtlMs,
  resolveStudioRunControlChannel,
  resolveStudioRunLeaseTtlMs,
  resolveStudioRunRedisPrefix,
  serializeStudioRunLeaseToken,
  studioRunScopeAdmissionField,
  type StudioRunCancellationCommand,
  type StudioRunCancellationListener,
  type StudioRunCoordinationLogger,
  type StudioRunCoordinationScope,
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

/**
 * One Session's admission state lives in two keys that share a Redis Cluster hash tag, so every
 * holder of that Session is decided in a single slot by a single script.
 *
 *   <prefix>:admission:v2:{<encoded-session>}:leases   HASH  field -> complete token
 *   <prefix>:admission:v2:{<encoded-session>}:expiry   ZSET  field -> absolute expiry (ms)
 *
 * The container keys carry a bounded cleanup TTL so an abandoned Session state cannot leak.
 */
const PRUNE_EXPIRED_HOLDERS = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local fields = redis.call('HGETALL', KEYS[1])
for index = 1, #fields, 2 do
  local field = fields[index]
  local score = redis.call('ZSCORE', KEYS[2], field)
  if not score or tonumber(score) <= now then
    redis.call('HDEL', KEYS[1], field)
    redis.call('ZREM', KEYS[2], field)
  end
end
`

/**
 * Hierarchical acquisition. Expired holders are pruned first (server time only), then:
 * a Legacy scope needs an empty holder set, a Scene scope needs the absent `legacy` field and
 * its own field absent. Returns 1 when acquired and 0 on a genuine conflict.
 */
const ACQUIRE_ADMISSION_SCRIPT = `${PRUNE_EXPIRED_HOLDERS}
if ARGV[4] == '1' then
  if redis.call('HLEN', KEYS[1]) > 0 then
    return 0
  end
else
  if redis.call('HEXISTS', KEYS[1], 'legacy') == 1 then
    return 0
  end
  if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then
    return 0
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[5])
return 1
`

/** Compare-and-extend: only the complete token may move the expiry of its own field. */
const RENEW_ADMISSION_SCRIPT = `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then
  return 0
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1
`

/** Compare-and-remove: another replica's holder is never released. */
const RELEASE_ADMISSION_SCRIPT = `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then
  return 0
end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
if redis.call('HLEN', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
else
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  redis.call('PEXPIRE', KEYS[2], ARGV[3])
end
return 1
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

  function admissionKeys(sessionId: string): { hash: string; expiry: string } {
    // The hash tag is the encoded Session, so both keys are guaranteed to share one slot.
    const tag = `{${encodeStudioRunKeySegment(sessionId)}}`
    return {
      hash: `${prefix}:${STUDIO_RUN_ADMISSION_NAMESPACE}:${tag}:leases`,
      expiry: `${prefix}:${STUDIO_RUN_ADMISSION_NAMESPACE}:${tag}:expiry`
    }
  }

  function cancellationKey(runId: string): string {
    return `${prefix}:cancel:${encodeStudioRunKeySegment(runId)}`
  }

  /** Bounded cleanup TTL for the container keys: several lease lifetimes, never unbounded. */
  function containerTtlMs(): number {
    return Math.max(leaseTtlMs * 4, leaseTtlMs + 60_000)
  }

  /** Local bookkeeping only: ownership decisions always come from Redis TIME inside the scripts. */
  function leaseExpiryFromLocalClock(): number {
    return Date.now() + leaseTtlMs
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

    async tryAcquire(scope: StudioRunCoordinationScope): Promise<StudioRunLease | null> {
      if (closePromise) {
        throw new Error('Studio Run coordinator is closed')
      }
      const keys = admissionKeys(scope.sessionId)
      const lease: StudioRunLease = {
        scope,
        leaseId: randomUUID(),
        ownerInstanceId,
        expiresAt: leaseExpiryFromLocalClock()
      }
      const reply = await publisher.eval(
        ACQUIRE_ADMISSION_SCRIPT,
        2,
        keys.hash,
        keys.expiry,
        studioRunScopeAdmissionField(scope),
        serializeStudioRunLeaseToken(lease),
        String(leaseTtlMs),
        scope.kind === 'legacy-session' ? '1' : '0',
        String(containerTtlMs())
      )
      // 0 is a genuine conflict; anything else is not a conflict, so it is treated as a
      // coordination failure rather than a silent admission.
      if (Number(reply) === 0) {
        return null
      }
      if (Number(reply) !== 1) {
        throw new Error('Studio Run admission returned an unexpected reply')
      }
      return lease
    },

    async renew(lease: StudioRunLease): Promise<StudioRunLease | null> {
      const keys = admissionKeys(lease.scope.sessionId)
      const reply = await publisher.eval(
        RENEW_ADMISSION_SCRIPT,
        2,
        keys.hash,
        keys.expiry,
        studioRunScopeAdmissionField(lease.scope),
        serializeStudioRunLeaseToken(lease),
        String(leaseTtlMs),
        String(containerTtlMs())
      )
      if (Number(reply) !== 1) {
        return null
      }
      return { ...lease, expiresAt: leaseExpiryFromLocalClock() }
    },

    async release(lease: StudioRunLease): Promise<boolean> {
      const keys = admissionKeys(lease.scope.sessionId)
      const reply = await publisher.eval(
        RELEASE_ADMISSION_SCRIPT,
        2,
        keys.hash,
        keys.expiry,
        studioRunScopeAdmissionField(lease.scope),
        serializeStudioRunLeaseToken(lease),
        String(containerTtlMs())
      )
      return Number(reply) === 1
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
