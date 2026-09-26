import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DistributedStudioEventBus,
  InMemoryStudioEventBus,
  createDefaultStudioEventBus,
  createInMemoryStudioPersistence,
  createStudioEventEnvelope,
  createStudioRender,
  createStudioRun,
  createStudioRuntimeService,
  decodeStudioEventEnvelope,
  encodeStudioEventEnvelope,
  resolveStudioEventChannel,
  resolveStudioEventTransport,
  type StudioAgentEvent,
  type StudioWorkspaceProvider
} from '../../index'
import { adaptStudioEvent } from '../../events/studio-event-adapter'
import { toPublicStudioEvent } from '../../http/public-dto'
import { FakeStudioEventBroker, RecordingStudioEventLogger } from '../support/fake-studio-event-broker'
import { run } from './factories'

const SESSION_A = 'sess-a'
const SESSION_B = 'sess-b'
const ORIGIN_LOCAL = 'origin-local'
const ORIGIN_REMOTE = 'origin-remote'

const workspaceProvider: StudioWorkspaceProvider = {
  kind: 'local',
  requiresDirectoryAccess: false,
  normalizeDirectory: (directory: string) => directory
}

function assistantTextEvent(sessionId: string, text: string): StudioAgentEvent {
  return { type: 'assistant_text', sessionId, runId: 'run-1', messageId: 'message-1', text }
}

function toolCallEvent(sessionId: string): StudioAgentEvent {
  return {
    type: 'tool_call',
    sessionId,
    runId: 'run-1',
    messageId: 'message-1',
    toolName: 'read',
    callId: 'call-1',
    input: { path: 'scene.py' }
  }
}

function runUpdatedEvent(sessionId: string): StudioAgentEvent {
  const run = createStudioRun({ ownerId: 'owner-secret', sessionId, inputText: 'hi', activeAgent: 'builder' })
  return { type: 'run_updated', sessionId, run }
}

function renderUpdatedEvent(sessionId: string): StudioAgentEvent {
  const render = createStudioRender({
    ownerId: 'owner-secret',
    sessionId,
    runId: 'run-1',
    kind: 'manim',
    title: 'Scene',
    concept: 'scene',
    outputMode: 'video'
  })
  return { type: 'render_updated', sessionId, render, runId: 'run-1' }
}

/** Serializes a valid envelope, optionally corrupted to model a hostile or stale producer. */
function foreignEnvelope(
  event: StudioAgentEvent,
  overrides: {
    originId?: string
    eventId?: string
    sessionId?: string
    publishedAt?: string
    version?: unknown
  } = {}
): string {
  const envelope = createStudioEventEnvelope({
    event,
    originId: overrides.originId ?? ORIGIN_REMOTE,
    eventId: overrides.eventId ?? 'event-remote-1'
  })
  const raw = JSON.parse(encodeStudioEventEnvelope(envelope)) as Record<string, unknown>

  if (overrides.sessionId !== undefined) raw.sessionId = overrides.sessionId
  if (overrides.publishedAt !== undefined) raw.publishedAt = overrides.publishedAt
  if (overrides.version !== undefined) raw.version = overrides.version
  return JSON.stringify(raw)
}

function createDistributedBus(options?: {
  broker?: FakeStudioEventBroker
  logger?: RecordingStudioEventLogger
  originId?: string
}) {
  const broker = options?.broker ?? new FakeStudioEventBroker()
  const logger = options?.logger ?? new RecordingStudioEventLogger()
  const bus = new DistributedStudioEventBus({
    broker,
    originId: options?.originId ?? ORIGIN_LOCAL,
    logger
  })
  return { broker, logger, bus }
}

function createCollector(): { events: StudioAgentEvent[]; listener: (event: StudioAgentEvent) => void } {
  const events: StudioAgentEvent[] = []
  return { events, listener: (event) => { events.push(event) } }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function readRepoSource(relativePath: string): string {
  const absolute = path.join(process.cwd(), relativePath)
  assert.ok(fs.existsSync(absolute), `expected repository source at ${absolute}`)
  return fs.readFileSync(absolute, 'utf8')
}

function indexOfOrFail(source: string, needle: string, label: string): number {
  const index = source.indexOf(needle)
  assert.notEqual(index, -1, `${label} was not found in the source`)
  return index
}

export async function runDistributedEventTests(): Promise<void> {
  // 1. Existing in-memory bus delivers only to matching session listeners.
  await run('in-memory bus routes events to the matching session only', async () => {
    const bus = new InMemoryStudioEventBus()
    const forA = createCollector()
    const forB = createCollector()
    bus.subscribe(SESSION_A, forA.listener)
    const unsubscribeB = bus.subscribe(SESSION_B, forB.listener)

    bus.publish(assistantTextEvent(SESSION_A, 'hello'))

    assert.deepEqual(forA.events.map((event) => event.type), ['assistant_text'])
    assert.deepEqual(forB.events, [])

    unsubscribeB()
    bus.publish(assistantTextEvent(SESSION_B, 'hidden'))
    assert.deepEqual(forB.events, [])
  })

  // 2. Local distributed publication reaches a local listener synchronously exactly once.
  await run('distributed publish delivers locally once and synchronously', async () => {
    const { bus, broker } = createDistributedBus()
    const forA = createCollector()
    bus.subscribe(SESSION_A, forA.listener)

    bus.publish(assistantTextEvent(SESSION_A, 'live'))

    // Delivered before any await: the synchronous domain contract is preserved.
    assert.deepEqual(forA.events.map((event) => event.type), ['assistant_text'])

    await bus.whenIdle()
    await bus.whenIdle()
    assert.equal(forA.events.length, 1)
    assert.equal(broker.published.length, 1)
  })

  // 3. Local publication emits one versioned broker envelope.
  await run('local publish emits exactly one versioned envelope', async () => {
    const { bus, broker } = createDistributedBus()
    const event = toolCallEvent(SESSION_A)

    bus.publish(event)
    await bus.whenIdle()

    assert.equal(broker.published.length, 1)
    const decoded = decodeStudioEventEnvelope(broker.published[0] as string)
    assert.equal(decoded.ok, true)
    if (!decoded.ok) {
      return
    }
    assert.equal(decoded.envelope.version, 1)
    assert.equal(decoded.envelope.originId, ORIGIN_LOCAL)
    assert.equal(decoded.envelope.sessionId, SESSION_A)
    assert.notEqual(decoded.envelope.eventId.trim(), '')
    assert.equal(Number.isNaN(Date.parse(decoded.envelope.publishedAt)), false)
    assert.deepEqual(decoded.envelope.event, event)
  })

  // 4 + 6. A valid foreign envelope reaches a matching listener once, and is not republished.
  await run('a foreign envelope delivers once locally and is never republished', async () => {
    const { bus, broker } = createDistributedBus()
    const forA = createCollector()
    bus.subscribe(SESSION_A, forA.listener)
    await bus.start()

    broker.deliver(foreignEnvelope(assistantTextEvent(SESSION_A, 'from replica B')))
    await bus.whenIdle()

    assert.equal(forA.events.length, 1)
    assert.deepEqual(forA.events[0], assistantTextEvent(SESSION_A, 'from replica B'))
    // Remote delivery is terminal: nothing is sent back to the broker, so no publish loop exists.
    assert.deepEqual(broker.published, [])
  })

  // 5. An own-origin Redis echo is ignored.
  await run('an own-origin echo is ignored', async () => {
    const { bus, broker, logger } = createDistributedBus()
    const forA = createCollector()
    bus.subscribe(SESSION_A, forA.listener)
    await bus.start()

    broker.deliver(foreignEnvelope(assistantTextEvent(SESSION_A, 'echo'), { originId: ORIGIN_LOCAL }))
    await bus.whenIdle()

    assert.deepEqual(forA.events, [])
    assert.deepEqual(logger.messages('warn'), [])
  })

  // 7. Session A events never reach session B listeners (local and remote).
  await run('session isolation holds for local and remote delivery', async () => {
    const { bus, broker } = createDistributedBus()
    const forA = createCollector()
    const forB = createCollector()
    bus.subscribe(SESSION_A, forA.listener)
    bus.subscribe(SESSION_B, forB.listener)
    await bus.start()

    bus.publish(assistantTextEvent(SESSION_A, 'local for A'))
    broker.deliver(foreignEnvelope(assistantTextEvent(SESSION_A, 'remote for A')))
    broker.deliver(foreignEnvelope(assistantTextEvent(SESSION_B, 'remote for B')))
    await bus.whenIdle()

    assert.deepEqual(forA.events.map((event) => (event as { text?: string }).text), ['local for A', 'remote for A'])
    assert.deepEqual(forB.events.map((event) => (event as { text?: string }).text), ['remote for B'])
  })

  // 8. Invalid envelopes are rejected without throwing.
  await run('invalid envelopes are rejected without throwing', async () => {
    const { bus, broker, logger } = createDistributedBus()
    const forA = createCollector()
    bus.subscribe(SESSION_A, forA.listener)
    await bus.start()

    const validEvent = assistantTextEvent(SESSION_A, 'valid')
    const validRaw = JSON.parse(foreignEnvelope(validEvent)) as Record<string, unknown>
    const withEvent = (event: unknown): string => JSON.stringify({ ...validRaw, event })

    const invalidEnvelopes: string[] = [
      'not json at all',
      '',
      JSON.stringify([1, 2, 3]),
      foreignEnvelope(validEvent, { version: 2 }),
      foreignEnvelope(validEvent, { eventId: '   ' }),
      foreignEnvelope(validEvent, { publishedAt: 'not-a-timestamp' }),
      foreignEnvelope(validEvent, { sessionId: SESSION_B }),
      withEvent('assistant_text'),
      withEvent({ type: 'mystery_event', sessionId: SESSION_A }),
      withEvent({ type: 'assistant_text', sessionId: SESSION_A, runId: 'run-1' }),
      withEvent({ type: 'tool_call', sessionId: SESSION_A, runId: 'run-1', messageId: 'm', toolName: 'read', callId: 'c' }),
      withEvent({ type: 'tool_result', sessionId: SESSION_A, runId: 'run-1', messageId: 'm', toolName: 'read', callId: 'c', status: 'pending' }),
      withEvent({ type: 'run_updated', sessionId: SESSION_A, run: { sessionId: SESSION_A } }),
      withEvent({ type: 'render_updated', sessionId: SESSION_A, render: { id: 'render-1', sessionId: SESSION_B } })
    ]

    for (const envelope of invalidEnvelopes) {
      // The codec itself never throws and never accepts the payload.
      assert.equal(decodeStudioEventEnvelope(envelope).ok, false, `codec accepted: ${envelope.slice(0, 60)}`)
      assert.doesNotThrow(() => broker.deliver(envelope))
    }

    await bus.whenIdle()
    assert.deepEqual(forA.events, [])
    assert.equal(logger.messages('warn').length, invalidEnvelopes.length)

    // Positive control: the very same shape with valid fields is accepted and delivered.
    broker.deliver(foreignEnvelope(validEvent))
    assert.equal(forA.events.length, 1)
  })

  // 9. A broker publish rejection causes no unhandled rejection; local delivery still succeeds.
  await run('broker publish failure preserves local delivery without unhandled rejections', async () => {
    const broker = new FakeStudioEventBroker()
    broker.publishError = new Error('redis unavailable')
    const logger = new RecordingStudioEventLogger()
    const { bus } = createDistributedBus({ broker, logger })
    const forA = createCollector()
    bus.subscribe(SESSION_A, forA.listener)

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      bus.publish(assistantTextEvent(SESSION_A, 'still local'))

      assert.equal(forA.events.length, 1)
      await bus.whenIdle()
      await bus.whenIdle()
      await nextTick()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    assert.deepEqual(unhandled, [])
    assert.equal(forA.events.length, 1)
    assert.deepEqual(logger.messages('error'), ['Studio event broker publish failed'])
  })

  // 10. Concurrent/repeated start calls subscribe once.
  await run('repeated and concurrent start calls subscribe once', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    const broker = new FakeStudioEventBroker({ startGate: gate })
    const { bus } = createDistributedBus({ broker })

    const first = bus.start()
    const second = bus.start()
    releaseGate()
    await Promise.all([first, second])
    await bus.start()

    assert.equal(broker.startCount, 1)
    assert.equal(broker.isStarted, true)
  })

  // 11. Close is idempotent and closes owned resources once.
  await run('close is idempotent', async () => {
    const { bus, broker } = createDistributedBus()
    await bus.start()

    await Promise.all([bus.close(), bus.close()])
    await bus.close()

    assert.equal(broker.closeCount, 1)
  })

  // 12. Memory factory mode creates no Redis broker and logs single-instance mode.
  await run('memory transport never builds a broker and warns once', async () => {
    const logger = new RecordingStudioEventLogger()
    let brokerCreations = 0
    const runtime = createDefaultStudioEventBus({
      env: { NODE_ENV: 'development', STUDIO_EVENT_TRANSPORT: 'memory' },
      createBroker: () => {
        brokerCreations += 1
        return new FakeStudioEventBroker()
      },
      logger
    })

    assert.equal(runtime.transport, 'memory')
    assert.equal(runtime.eventBus instanceof InMemoryStudioEventBus, true)
    assert.equal(runtime.eventBus instanceof DistributedStudioEventBus, false)
    assert.equal(brokerCreations, 0)
    assert.deepEqual(logger.messages('warn'), [
      'Studio event transport is "memory": events reach only SSE clients connected to this process (single-instance mode)'
    ])

    // Lifecycle stays callable and idempotent in memory mode.
    await runtime.start()
    await runtime.close()
    await runtime.close()
    assert.equal(brokerCreations, 0)

    // Test environments default to memory as well, still without a broker.
    const testRuntime = createDefaultStudioEventBus({
      env: { NODE_ENV: 'test' },
      createBroker: () => {
        brokerCreations += 1
        return new FakeStudioEventBroker()
      },
      logger
    })
    assert.equal(testRuntime.transport, 'memory')
    assert.equal(brokerCreations, 0)
  })

  // 13. Redis factory mode selects the distributed implementation.
  await run('redis transport builds the distributed bus on the deployment channel', async () => {
    const logger = new RecordingStudioEventLogger()
    const channels: string[] = []
    const brokers: FakeStudioEventBroker[] = []
    const runtime = createDefaultStudioEventBus({
      env: { NODE_ENV: 'production' },
      createBroker: ({ channel }) => {
        channels.push(channel)
        const broker = new FakeStudioEventBroker()
        brokers.push(broker)
        return broker
      },
      logger
    })

    assert.equal(runtime.transport, 'redis')
    assert.equal(runtime.eventBus instanceof DistributedStudioEventBus, true)
    assert.deepEqual(channels, ['manimcat:production:studio-events'])

    await runtime.start()
    await runtime.start()
    assert.equal((brokers[0] as FakeStudioEventBroker).startCount, 1)

    await runtime.close()
    assert.equal((brokers[0] as FakeStudioEventBroker).closeCount, 1)

    // An explicit override keeps deployments that share one Redis on separate channels.
    const overrideChannels: string[] = []
    createDefaultStudioEventBus({
      env: { NODE_ENV: 'production', STUDIO_EVENT_REDIS_CHANNEL: 'manimcat:staging:studio-events' },
      createBroker: ({ channel }) => {
        overrideChannels.push(channel)
        return new FakeStudioEventBroker()
      },
      logger
    })
    assert.deepEqual(overrideChannels, ['manimcat:staging:studio-events'])

    assert.equal(resolveStudioEventChannel({ NODE_ENV: 'production' }), 'manimcat:production:studio-events')
    assert.equal(resolveStudioEventChannel({ STUDIO_EVENT_REDIS_CHANNEL: '' }), 'manimcat:development:studio-events')
    assert.throws(() => resolveStudioEventChannel({ STUDIO_EVENT_REDIS_CHANNEL: 'bad channel' }))
    assert.throws(() => resolveStudioEventChannel({ STUDIO_EVENT_REDIS_CHANNEL: 'x'.repeat(201) }))
  })

  // 14. Unknown transport configuration fails fast.
  await run('unknown transport configuration fails fast', async () => {
    assert.throws(() => resolveStudioEventTransport({ STUDIO_EVENT_TRANSPORT: 'kafka' }))
    assert.throws(() => createDefaultStudioEventBus({ env: { STUDIO_EVENT_TRANSPORT: 'streams' } }))
    assert.equal(resolveStudioEventTransport({ STUDIO_EVENT_TRANSPORT: ' MEMORY ' }), 'memory')
    assert.equal(resolveStudioEventTransport({ NODE_ENV: 'development' }), 'redis')
    assert.equal(resolveStudioEventTransport({ NODE_ENV: 'test' }), 'memory')
    // A redis-mode factory without a broker factory is a wiring error, not a silent downgrade.
    assert.throws(() => createDefaultStudioEventBus({ env: { NODE_ENV: 'production' } }))
  })

  // 15. Runtime external-event adaptation remains unchanged for remote events.
  await run('runtime external-event adaptation works for remote events', async () => {
    const { bus, broker } = createDistributedBus()
    const runtime = createStudioRuntimeService({
      persistence: createInMemoryStudioPersistence(),
      workspaceProvider,
      eventBus: bus
    })
    const external: Array<{ type: string; properties: Record<string, unknown> }> = []
    runtime.subscribeExternalEvents(SESSION_A, (event) => { external.push(event) })
    await bus.start()

    broker.deliver(foreignEnvelope(toolCallEvent(SESSION_A)))

    assert.deepEqual(external.map((event) => event.type), ['tool.call'])
    assert.equal(external[0]?.properties.sessionId, SESSION_A)
    assert.equal(external[0]?.properties.runId, 'run-1')
    assert.equal(external[0]?.properties.toolName, 'read')
    assert.equal(external[0]?.properties.callId, 'call-1')
    assert.deepEqual(external[0]?.properties.input, { path: 'scene.py' })
  })

  // 16. Public run.updated and render.updated events remain sanitized after remote delivery.
  await run('remote run and render events stay sanitized on the public path', async () => {
    const { bus, broker } = createDistributedBus()
    const domainEvents = createCollector()
    bus.subscribe(SESSION_A, domainEvents.listener)
    await bus.start()

    const runEvent = runUpdatedEvent(SESSION_A)
    const renderEvent = renderUpdatedEvent(SESSION_A)
    broker.deliver(foreignEnvelope(runEvent))
    broker.deliver(foreignEnvelope(renderEvent))

    assert.equal(domainEvents.events.length, 2)

    const published = domainEvents.events.map((event) => {
      const adapted = adaptStudioEvent(event)
      assert.ok(adapted, `expected ${event.type} to adapt to a public event`)
      return toPublicStudioEvent(adapted)
    })

    const runProperties = published[0]?.properties as Record<string, unknown>
    const renderProperties = published[1]?.properties as Record<string, unknown>
    const publicRun = runProperties.run as Record<string, unknown>
    const publicRender = renderProperties.render as Record<string, unknown>

    // The internal values did carry ownerId; the public path removes it.
    assert.equal('ownerId' in (runEvent as { run: Record<string, unknown> }).run, true)
    assert.equal('ownerId' in (renderEvent as { render: Record<string, unknown> }).render, true)
    assert.equal('ownerId' in publicRun, false)
    assert.equal('ownerId' in publicRender, false)
    assert.equal(published[0]?.type, 'run.updated')
    assert.equal(published[1]?.type, 'render.updated')
    assert.equal(runProperties.sessionId, SESSION_A)
  })

  // 17. Server lifecycle ordering, asserted from source without starting a server.
  await run('server lifecycle orders transport start before listen and close before Redis', async () => {
    const serverSource = readRepoSource('src/server.ts')
    const startIndex = indexOfOrFail(serverSource, 'await studioEventRuntime.start()', 'transport start')
    const listenIndex = indexOfOrFail(serverSource, 'await tryListen(', 'tryListen call')
    assert.ok(startIndex < listenIndex, 'Studio event transport must start before the HTTP listener')

    const closeIndex = indexOfOrFail(serverSource, 'await studioEventRuntime.close()', 'transport close')
    const queueIndex = indexOfOrFail(serverSource, 'await closeQueue()', 'closeQueue call')
    const redisIndex = indexOfOrFail(serverSource, 'await redisClient.quit()', 'redisClient.quit call')
    assert.ok(closeIndex < queueIndex, 'Studio event subscriber must close before the queue')
    assert.ok(queueIndex < redisIndex, 'The queue must close before the shared Redis client quits')

    // Startup failure releases the owned subscriber before exiting.
    const fatalIndex = indexOfOrFail(serverSource, '[StartupFatal]', 'startup failure handler')
    assert.ok(serverSource.indexOf('await studioEventRuntime.close()', fatalIndex) > fatalIndex)

    const runtimeSource = readRepoSource('src/studio-agent/runtime/runtime-service.ts')
    assert.equal(runtimeSource.includes('createDefaultStudioEventBus'), true)
    assert.equal(runtimeSource.includes('eventBus: studioEventRuntime.eventBus'), true)
    // The injectable runtime factory must stay free of the global Redis client.
    assert.equal(runtimeSource.includes("config/redis"), false)
    const factorySource = readRepoSource('src/studio-agent/runtime/create-runtime-service.ts')
    assert.equal(factorySource.includes('redis'), false)
  })

  // 17b. Compose deployment stays scale-safe and documents its prerequisites.
  await run('compose deployment keeps a scale-safe host port and documents prerequisites', async () => {
    const compose = readRepoSource('docker-compose.yml')
    const envExample = readRepoSource('.env.example')

    // No fixed container name on the application service, so `--scale` is possible.
    assert.equal(/container_name:\s*manimcat\s*$/m.test(compose), false)

    // The host binding has its own variable, so replicas do not fight over one host port.
    assert.equal(compose.includes('"${MANIMCAT_PUBLISHED_PORT:-3000}:3000"'), true)
    assert.equal(compose.includes('"${PORT:-3000}:3000"'), false)
    // The container itself still receives the application port.
    assert.equal(/^\s*-\s*PORT=3000\s*$/m.test(compose), true)
    // Documented scale run: Docker-assigned host ports, then `docker compose port`.
    assert.equal(compose.includes('MANIMCAT_PUBLISHED_PORT=0 docker compose up --scale manimcat=2'), true)
    assert.equal(compose.includes('docker compose port manimcat 3000'), true)
    // Ingress is operator infrastructure: no proxy ships or is claimed here.
    assert.equal(/(^|\n)\s*(nginx|traefik)\s*:/i.test(compose), false)
    assert.equal(compose.includes('reverse proxy'), true)

    // Shared persistence is documented as the multi-replica prerequisite, and stays opt-in.
    assert.equal(envExample.includes('Multi-replica Studio requires shared persistence'), true)
    assert.equal(envExample.includes('ENABLE_STUDIO_DB=true with Supabase'), true)
    assert.equal(envExample.includes('MANIMCAT_PUBLISHED_PORT'), true)
    assert.equal(/^ENABLE_STUDIO_DB=true\s*$/m.test(envExample), false)
  })

  // 17c. Redis stays behind the broker boundary.
  await run('Redis concerns stay inside the broker adapter', async () => {
    const eventsDirectory = path.join(process.cwd(), 'src/studio-agent/events')
    const modules = fs.readdirSync(eventsDirectory).filter((entry) => entry.endsWith('.ts')).sort()
    for (const expected of [
      'create-default-studio-event-bus.ts',
      'distributed-studio-event-bus.ts',
      'event-bus.ts',
      'redis-studio-event-broker.ts',
      'studio-event-adapter.ts',
      'studio-event-broker.ts',
      'studio-event-envelope.ts'
    ]) {
      assert.equal(modules.includes(expected), true, `expected ${expected} in the events module`)
    }

    const redisAware = modules.filter((entry) =>
      readRepoSource(path.join('src/studio-agent/events', entry)).includes("from '../../config/redis'")
    )
    assert.deepEqual(redisAware, ['redis-studio-event-broker.ts'])

    // The Redis adapter stays out of the package barrel, so tests never build a live client.
    const barrel = readRepoSource('src/studio-agent/index.ts')
    assert.equal(barrel.includes('redis-studio-event-broker'), false)

    // The domain port and the domain bus interface carry no transport imports.
    const portSource = readRepoSource('src/studio-agent/events/studio-event-broker.ts')
    assert.equal(/from 'ioredis'/.test(portSource), false)
    const domainTypes = readRepoSource('src/studio-agent/domain/event-types.ts')
    assert.equal(/from 'ioredis'/.test(domainTypes), false)
  })
}
