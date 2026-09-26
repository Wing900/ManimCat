/**
 * Task 09 integration specification: the real Redis adapters, no fakes.
 *
 * Runs against an isolated, task-owned Redis (unique prefix and channels) and exercises the
 * production `RedisStudioRunCoordinator` and `RedisStudioEventBroker` through their public
 * factories. It is deliberately NOT registered in `tests/run-tests.ts`, because it needs a live
 * Redis; run it directly:
 *
 *   node dist-tests/src/studio-agent/tests/integration/redis-coordination-integration.run.js
 *
 * Configuration (all optional except the port):
 *   TASK09_REDIS_HOST, TASK09_REDIS_PORT, TASK09_REDIS_DB,
 *   TASK09_PREFIX, TASK09_CONTROL_CHANNEL, TASK09_EVENT_CHANNEL
 */
import assert from 'node:assert/strict'
import Redis from 'ioredis'
import {
  createStudioEventEnvelope,
  createStudioRun,
  DistributedStudioEventBus,
  encodeStudioEventEnvelope,
  StudioRunCoordinationService,
  type StudioAgentEvent
} from '../../index'
import {
  createStudioRunCancellationCommand,
  encodeStudioRunCancellationCommand
} from '../../run-coordination/studio-run-cancellation-codec'
import { createRedisStudioRunCoordinator } from '../../run-coordination/redis-studio-run-coordinator'
import { createRedisStudioEventBroker } from '../../events/redis-studio-event-broker'
import type {
  StudioRunCoordinatorPort,
  StudioRunLease
} from '../../run-coordination/studio-run-coordinator'

const HOST = process.env.TASK09_REDIS_HOST ?? '127.0.0.1'
const PORT = Number(process.env.TASK09_REDIS_PORT ?? '0')
const DB = Number(process.env.TASK09_REDIS_DB ?? '0')
const PREFIX = process.env.TASK09_PREFIX ?? 'manimcat:task09:it'
const CONTROL_CHANNEL = process.env.TASK09_CONTROL_CHANNEL ?? `${PREFIX}:control`
const EVENT_CHANNEL = process.env.TASK09_EVENT_CHANNEL ?? `${PREFIX}:events`
const OWNER_ID = 'task09-owner'
const POLL_MS = 20

if (!PORT) {
  console.error('TASK09_REDIS_PORT is required')
  process.exit(2)
}

const diagnostics: string[] = []
function record(line: string): void {
  diagnostics.push(line)
}

const silentLogger = { info(): void {}, warn(): void {}, error(): void {} }
const recordingLogger = {
  info(): void {},
  warn(message: string): void {
    record(`warn ${message}`)
  },
  error(message: string, meta?: unknown): void {
    record(`error ${message} ${String(meta ?? '')}`)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Bounded polling with an explicit deadline: never a blind sleep. */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await delay(POLL_MS)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
}

function createClient(label: string): Redis {
  const client = new Redis({
    host: HOST,
    port: PORT,
    db: DB,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times: number) => (times > 3 ? null : 50)
  })
  client.on('error', (error: Error) => {
    record(`client ${label} error: ${error.message}`)
  })
  return client
}

async function connect(label: string): Promise<Redis> {
  const client = createClient(label)
  await client.connect()
  return client
}

const results: Array<{ name: string; ok: boolean; detail?: string }> = []

async function check(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, detail })
    console.error(`FAIL ${name}: ${detail}`)
  }
}

function runEvent(sessionId: string, runId: string): StudioAgentEvent {
  const run = createStudioRun({
    ownerId: OWNER_ID,
    sessionId,
    inputText: 'integration',
    activeAgent: 'builder'
  })
  return { type: 'run_updated', sessionId, run: { ...run, id: runId } }
}

async function main(): Promise<void> {
  const coordinationPublisher = await connect('coordination-publisher')
  const coordinationPeer = await connect('coordination-peer')
  const coordinationSpare = await connect('coordination-spare')
  const eventPublisher = await connect('event-publisher')
  const eventPeer = await connect('event-peer')
  const rawClient = await connect('raw')

  const services: StudioRunCoordinationService[] = []
  const buses: DistributedStudioEventBus[] = []
  const closers: Array<() => Promise<void>> = []

  try {
    // 1. Two instances contend for one Session; exactly one acquires it.
    const coordinatorA = createRedisStudioRunCoordinator({
      publisher: coordinationPublisher,
      prefix: PREFIX,
      controlChannel: CONTROL_CHANNEL,
      ownerInstanceId: 'owner-a',
      logger: silentLogger
    })
    const coordinatorB = createRedisStudioRunCoordinator({
      publisher: coordinationPeer,
      prefix: PREFIX,
      controlChannel: CONTROL_CHANNEL,
      ownerInstanceId: 'owner-b',
      logger: silentLogger
    })

    const contention: { lease: StudioRunLease | null; holder: StudioRunCoordinatorPort; rival: StudioRunCoordinatorPort } = {
      lease: null,
      holder: coordinatorA,
      rival: coordinatorB
    }
    await check('two instances contend for one Session and exactly one wins', async () => {
      const [first, second] = await Promise.all([
        coordinatorA.tryAcquireSession('session-1'),
        coordinatorB.tryAcquireSession('session-1')
      ])
      const winners = [first, second].filter((lease) => lease !== null)
      assert.equal(winners.length, 1, 'exactly one instance must hold the lease')
      contention.lease = first ?? second
      contention.holder = first ? coordinatorA : coordinatorB
      contention.rival = first ? coordinatorB : coordinatorA
    })

    const held = contention.lease
    if (!held) {
      throw new Error('the contention check must produce a lease')
    }
    const heldClient = contention.holder
    const rival = contention.rival

    // 2. A matching token renews.
    await check('a matching lease token renews the lease', async () => {
      const renewed = await heldClient.renewSession(held)
      assert.ok(renewed, 'the owner must be able to renew')
      assert.equal(renewed?.leaseId, held.leaseId)
      assert.ok((renewed?.expiresAt ?? 0) >= held.expiresAt, 'renewal must extend the expiration')
    })

    // 3. A wrong token can neither renew nor release.
    await check('a wrong token can neither renew nor release', async () => {
      const impostor: StudioRunLease = { ...held, leaseId: `${held.leaseId}-impostor` }
      assert.equal(await rival.renewSession(impostor), null, 'a foreign token must not renew')
      assert.equal(await rival.releaseSession(impostor), false, 'a foreign token must not release')
      assert.ok(await heldClient.renewSession(held), 'the real owner still holds the lease')
    })

    // 4. Release lets another instance take over.
    await check('release allows another instance to take over', async () => {
      assert.equal(await heldClient.releaseSession(held), true, 'the owner releases its own lease')
      const taken = await rival.tryAcquireSession('session-1')
      assert.ok(taken, 'the released session must be acquirable')
      assert.equal(await rival.releaseSession(taken), true, 'cleanup: release the takeover lease')
    })

    // 5. Expiry lets another instance take over (short, safe TTL).
    await check('lease expiry allows another instance to take over', async () => {
      const shortTtl = 1_200
      const shortA = createRedisStudioRunCoordinator({
        publisher: coordinationPublisher,
        prefix: PREFIX,
        controlChannel: CONTROL_CHANNEL,
        ownerInstanceId: 'owner-a-short',
        leaseTtlMs: shortTtl,
        logger: silentLogger
      })
      const shortB = createRedisStudioRunCoordinator({
        publisher: coordinationPeer,
        prefix: PREFIX,
        controlChannel: CONTROL_CHANNEL,
        ownerInstanceId: 'owner-b-short',
        leaseTtlMs: shortTtl,
        logger: silentLogger
      })
      const expiring = await shortA.tryAcquireSession('session-expiry')
      assert.ok(expiring, 'the first instance acquires the session')
      assert.equal(await shortB.tryAcquireSession('session-expiry'), null, 'it conflicts while live')
      const deadline = Date.now() + 8_000
      let taken: StudioRunLease | null = null
      while (Date.now() < deadline && !taken) {
        taken = await shortB.tryAcquireSession('session-expiry')
        if (!taken) {
          await delay(POLL_MS)
        }
      }
      assert.ok(taken, 'an expired lease must be acquirable by another instance')
      await shortB.releaseSession(taken)
    })

    // 6. The cancellation marker is durable and visible to the other instance.
    await check('the cancellation marker is durable and visible to another instance', async () => {
      const command = await coordinatorA.requestCancellation('run-marker', 'stop now')
      assert.equal(command.runId, 'run-marker')
      const seen = await coordinatorB.readCancellation('run-marker')
      assert.ok(seen, 'the other instance must read the durable marker')
      assert.equal(seen?.runId, 'run-marker')
      assert.equal(seen?.reason, 'stop now')
      assert.equal(await coordinatorB.readCancellation('run-absent'), null, 'no marker means no cancellation')
    })

    // 7. The control channel delivers the cancellation once to the owning service.
    const aborts: string[] = []
    const owningService = new StudioRunCoordinationService({
      coordinator: coordinatorB,
      logger: recordingLogger,
      scheduler: { schedule: () => () => undefined }
    })
    services.push(owningService)
    await check('the owning service is aborted exactly once through Pub/Sub', async () => {
      await owningService.start()
      const admission = await owningService.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-cancel' })
      assert.equal(admission.status, 'reserved', `admission must succeed: ${JSON.stringify(admission)}`)
      if (admission.status !== 'reserved') {
        return
      }
      await owningService.attachRun({
        reservation: admission.reservation,
        runId: 'run-cancel',
        abort: (reason?: string) => aborts.push(reason ?? 'unspecified')
      })
      await coordinatorA.requestCancellation('run-cancel', 'stop by peer')
      await waitFor(() => aborts.length > 0, 'cancellation delivery')
      await delay(150)
      assert.deepEqual(aborts, ['stop by peer'], 'exactly one abort with the transported reason')
      await owningService.finishRun({ reservation: admission.reservation, runId: 'run-cancel' })
    })

    // 8. Event Pub/Sub crosses instances without a self-echo duplicate.
    const busA = new DistributedStudioEventBus({
      broker: createRedisStudioEventBroker({
        publisher: eventPublisher,
        channel: EVENT_CHANNEL,
        logger: recordingLogger
      }),
      originId: 'origin-a',
      logger: recordingLogger
    })
    const busB = new DistributedStudioEventBus({
      broker: createRedisStudioEventBroker({
        publisher: eventPeer,
        channel: EVENT_CHANNEL,
        logger: recordingLogger
      }),
      originId: 'origin-b',
      logger: recordingLogger
    })
    buses.push(busA, busB)
    const seenA: StudioAgentEvent[] = []
    const seenB: StudioAgentEvent[] = []
    await check('a run.updated event crosses instances without self-echo duplication', async () => {
      busA.subscribe('session-events', (event) => seenA.push(event))
      busB.subscribe('session-events', (event) => seenB.push(event))
      await busA.start()
      await busB.start()
      busA.publish(runEvent('session-events', 'run-1'))
      await waitFor(() => seenB.length === 1, 'cross-instance delivery')
      await waitFor(() => seenA.length === 1, 'local delivery')
      await busA.whenIdle()
      await delay(200)
      assert.equal(seenA.length, 1, 'the publisher must not receive its own envelope twice')
      assert.equal(seenB.length, 1, 'the peer must receive the event exactly once')
      assert.equal(seenB[0]?.type, 'run_updated')
    })

    // 9. Malformed payloads never take the subscribers down.
    const malformedAborts: string[] = []
    // A second service needs its own coordinator: a coordinator belongs to exactly one service,
    // so its `start()` is idempotent for that service and would not re-register a listener.
    const survivingCoordinator = createRedisStudioRunCoordinator({
      publisher: coordinationSpare,
      prefix: PREFIX,
      controlChannel: CONTROL_CHANNEL,
      ownerInstanceId: 'owner-survivor',
      logger: recordingLogger
    })
    const survivingService = new StudioRunCoordinationService({
      coordinator: survivingCoordinator,
      logger: recordingLogger,
      scheduler: { schedule: () => () => undefined }
    })
    services.push(survivingService)
    await check('malformed control and event payloads do not break the subscribers', async () => {
      await rawClient.publish(EVENT_CHANNEL, '{ not json')
      await rawClient.publish(CONTROL_CHANNEL, '{"version":99,"commandId":"c"}')
      await rawClient.publish(CONTROL_CHANNEL, encodeStudioRunCancellationCommand(createStudioRunCancellationCommand({ runId: 'run-bad', reason: 'ok' })).slice(0, 12))
      await delay(150)

      await survivingService.start()
      const admission = await survivingService.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-bad' })
      assert.equal(admission.status, 'reserved', `the service must still admit: ${JSON.stringify(admission)}`)
      if (admission.status !== 'reserved') {
        return
      }
      await survivingService.attachRun({
        reservation: admission.reservation,
        runId: 'run-bad',
        abort: (reason?: string) => malformedAborts.push(reason ?? 'unspecified')
      })
      await rawClient.publish(
        CONTROL_CHANNEL,
        encodeStudioRunCancellationCommand(createStudioRunCancellationCommand({ runId: 'run-bad', reason: 'after garbage' }))
      )
      await waitFor(() => malformedAborts.length > 0, 'control channel survives malformed payloads')
      assert.deepEqual(malformedAborts, ['after garbage'])
      await survivingService.finishRun({ reservation: admission.reservation, runId: 'run-bad' })

      busA.publish(runEvent('session-events', 'run-2'))
      await waitFor(() => seenB.length === 2, 'event channel survives malformed payloads')
      assert.equal(seenB[1]?.type, 'run_updated')
    })

    // 10. Closing an owned subscriber leaves the shared publisher usable.
    await check('closing the owned subscribers leaves the shared publisher usable', async () => {
      await buses[1]?.close()
      await buses[0]?.close()
      assert.equal(eventPublisher.status, 'ready', 'the shared publisher must stay connected')
      const fresh = await connect('fresh-subscriber')
      closers.push(async () => {
        await fresh.quit()
      })
      const received: string[] = []
      fresh.on('message', (_channel: string, payload: string) => received.push(payload))
      await fresh.subscribe(EVENT_CHANNEL)
      await delay(100)
      await eventPublisher.publish(
        EVENT_CHANNEL,
        encodeStudioEventEnvelope(
          createStudioEventEnvelope({
            originId: 'origin-close',
            event: runEvent('session-events', 'run-3')
          })
        )
      )
      await waitFor(() => received.length === 1, 'publish after subscriber close')
      assert.equal(received.length, 1)
    })

    // 11. Only task-owned keys exist, and they are cleaned up.
    await check('task-owned keys are the only ones created and they are removed', async () => {
      const keys = await coordinationPublisher.keys(`${PREFIX}*`)
      assert.ok(keys.length > 0, 'the run above must have created task-owned keys')
      assert.ok(
        keys.every((key) => key.startsWith(PREFIX)),
        `every key must live under the task prefix: ${keys.join(', ')}`
      )
      await coordinationPublisher.del(...keys)
      const remaining = await coordinationPublisher.keys(`${PREFIX}*`)
      assert.deepEqual(remaining, [], 'every task-owned key must be removed')
    })
  } finally {
    for (const service of services) {
      await service.close().catch(() => undefined)
    }
    for (const bus of buses) {
      await bus.close().catch(() => undefined)
    }
    for (const closer of closers) {
      await closer().catch(() => undefined)
    }
    for (const client of [coordinationPublisher, coordinationPeer, coordinationSpare, eventPublisher, eventPeer, rawClient]) {
      await client.quit().catch(() => undefined)
    }
    record(`diagnostics: ${diagnostics.length}`)
    const failures = results.filter((result) => !result.ok)
    console.log(
      `INTEGRATION_SUMMARY ${JSON.stringify({
        total: results.length,
        passed: results.length - failures.length,
        failed: failures.map((result) => result.name)
      })}`
    )
    for (const line of diagnostics) {
      console.log(`INTEGRATION_DIAG ${line}`)
    }
    process.exitCode = failures.length > 0 ? 1 : 0
  }
}

void main().then(() => {
  // The shared `redisClient` singleton lives for the module lifetime, so the runner exits
  // explicitly instead of waiting for it to release the event loop.
  process.exit(process.exitCode ?? 0)
})
