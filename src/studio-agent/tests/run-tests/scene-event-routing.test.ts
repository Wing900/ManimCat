import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Request, Response } from 'express'
import {
  createInMemoryStudioPersistence,
  createStudioAssistantMessage,
  createStudioRender,
  createStudioRun,
  createStudioScene,
  createStudioSession,
  createStudioToolPart,
  createStudioUserMessage,
  InMemoryStudioEventBus,
  matchesStudioEventScope,
  readStudioEventSceneId,
  StudioRunProcessor,
  type StudioAgentEvent,
  type StudioProcessorStreamEvent,
  type StudioRun,
  type StudioScene,
  type StudioSceneSnapshot,
  type StudioSession,
  type StudioTextPart,
  type StudioToolPart
} from '../../index'
import {
  STUDIO_EVENT_SCOPE_ID_MAX_LENGTH,
  isStudioEventScopeIdentifier
} from '../../domain/event-scope'
import {
  createStudioEventEnvelope,
  decodeStudioEventEnvelope,
  encodeStudioEventEnvelope
} from '../../events/studio-event-envelope'
import { adaptStudioEvent, type StudioExternalEvent } from '../../events/studio-event-adapter'
import {
  toPublicStudioEvent,
  toPublicStudioSceneEvent,
  toPublicStudioSceneRun,
  toPublicStudioSceneSnapshot,
  toPublicStudioSceneToolState
} from '../../http/public-dto'
import {
  openStudioAgentEventStream,
  type StudioEventStreamInput
} from '../../../routes/helpers/studio-agent-sse'
import { resolveStudioSceneScope } from '../../../routes/helpers/studio-agent-scene-authorization'
import { parseStudioCreateSceneRunRequest } from '../../../routes/helpers/studio-agent-run-request'
import { parseStudioScenePathParams } from '../../../routes/helpers/studio-agent-scene-params'
import {
  handleStudioSceneEventStreamRequest,
  handleStudioSceneRunRequest,
  type StudioSceneRouteDependencies
} from '../../../routes/helpers/studio-agent-scene-handlers'
import { run } from './factories'

/**
 * Task 11B2C — public Scene Run API and Scene event routing.
 *
 * Behavioral specs drive the real scope rule, the real event producers, the real envelope codec,
 * the real public DTOs and the real SSE lifecycle with fake Express objects. The route wiring
 * itself (Express handlers) is asserted against the shipped route source, because the Router is not
 * instantiated in this suite and no HTTP server may be started.
 */

const OWNER_ID = 'owner-scene-events'
const SESSION_ID = 'session-scene-events'
const SCENE_A = 'scene_aaaa'
const SCENE_B = 'scene_bbbb'
const ROUTE_SOURCE_PATH = path.join(process.cwd(), 'src', 'routes', 'studio-agent.route.ts')
const HANDLER_SOURCE_PATH = path.join(
  process.cwd(),
  'src',
  'routes',
  'helpers',
  'studio-agent-scene-handlers.ts'
)

interface FakeResponse {
  statusCode: number | null
  payload: unknown
  headers: Record<string, string>
  chunks: string[]
  ended: boolean
  endCount: number
}

/** Fake response with an optional write failure and an optional response-level close emitter. */
function createFakeResponse(options?: {
  failWriteAt?: number
}): { res: Response; capture: FakeResponse; emitClose: () => void; emitError: () => void } {
  const capture: FakeResponse = {
    statusCode: null,
    payload: undefined,
    headers: {},
    chunks: [],
    ended: false,
    endCount: 0
  }
  const closeListeners: Array<() => void> = []
  const errorListeners: Array<() => void> = []
  const res = {
    status(code: number) {
      capture.statusCode = code
      return res
    },
    json(payload: unknown) {
      capture.payload = payload
      return res
    },
    setHeader(name: string, value: string) {
      capture.headers[name] = value
      return res
    },
    flushHeaders() {},
    write(chunk: string) {
      if (options?.failWriteAt !== undefined && capture.chunks.length >= options.failWriteAt) {
        throw new Error('response write failed')
      }
      capture.chunks.push(chunk)
      return true
    },
    end() {
      capture.ended = true
      capture.endCount += 1
    },
    on(event: string, listener: () => void) {
      if (event === 'close') {
        closeListeners.push(listener)
      }
      if (event === 'error') {
        errorListeners.push(listener)
      }
      return res
    }
  } as unknown as Response
  return {
    res,
    capture,
    emitClose: () => closeListeners.forEach((listener) => listener()),
    emitError: () => errorListeners.forEach((listener) => listener())
  }
}

function createFakeRequest(): { req: Request; close: () => void; abort: () => void } {
  const closeListeners: Array<() => void> = []
  const abortListeners: Array<() => void> = []
  const req = {
    on(event: string, listener: () => void) {
      if (event === 'close') {
        closeListeners.push(listener)
      }
      if (event === 'aborted') {
        abortListeners.push(listener)
      }
      return req
    }
  } as unknown as Request
  const emit = (listeners: Array<() => void>) => () => listeners.forEach((listener) => listener())
  return { req, close: emit(closeListeners), abort: emit(abortListeners) }
}

/** Deterministic timer adapter: the specification fires the heartbeat by hand. */
function createFakeClock(): {
  clock: { setInterval: (handler: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void; now: () => number }
  tick: () => void
  liveIntervals: () => number
  cleared: () => number
} {
  const handlers = new Map<number, () => void>()
  let handle = 0
  let cleared = 0
  const clock = {
    setInterval(handler: () => void) {
      handle += 1
      handlers.set(handle, handler)
      return handle
    },
    clearInterval(target: unknown) {
      if (handlers.delete(target as number)) {
        cleared += 1
      }
    },
    now: () => 1_700_000_000_000
  }
  return {
    clock,
    tick: () => handlers.forEach((handler) => handler()),
    liveIntervals: () => handlers.size,
    cleared: () => cleared
  }
}

interface HandlerFixture {
  session: StudioSession
  scene: StudioScene
  run: StudioRun
  snapshot: StudioSceneSnapshot
  deps: StudioSceneRouteDependencies
  calls: {
    startRun: number
    getScene: number
    getSession: number
    getSceneSnapshot: number
    streams: StudioEventStreamInput[]
  }
}

/**
 * Fake dependency bag of the Scene handlers: enough to describe the accepted DTO, every status
 * mapping and the single admission call without a real runtime, an HTTP socket or a model.
 */
function createHandlerFixture(options?: {
  startRunStatus?: 'started' | 'conflict' | 'not_found' | 'coordination_unavailable'
  scene?: StudioScene | null
  session?: StudioSession | null
  snapshot?: StudioSceneSnapshot | null
  snapshotThrows?: boolean
}): HandlerFixture {
  const session = options?.session === undefined
    ? createStudioSession({
        ownerId: OWNER_ID,
        projectId: 'project-scene-events',
        agentType: 'builder',
        title: 'Scene handler',
        directory: 'workspace-scene-handler'
      })
    : options.session
  const scene = options?.scene === undefined
    ? createStudioScene({
        ownerId: OWNER_ID,
        sessionId: session?.id ?? SESSION_ID,
        id: SCENE_A,
        position: 0,
        sourcePath: 'scenes/scene_aaaa.py'
      })
    : options.scene
  const run: StudioRun = {
    ...createStudioRun({
      ownerId: OWNER_ID,
      sessionId: session?.id ?? SESSION_ID,
      sceneId: SCENE_A,
      inputText: 'draw',
      activeAgent: 'builder'
    }),
    status: 'pending',
    error: 'internal failure text'
  }
  const defaultSnapshot: StudioSceneSnapshot = {
    scene: scene as StudioScene,
    messages: [createStudioUserMessage({ sessionId: session?.id ?? SESSION_ID, sceneId: SCENE_A, text: 'draw' })],
    runs: [run],
    renders: []
  }
  const snapshot: StudioSceneSnapshot | null =
    options?.snapshot === undefined ? defaultSnapshot : options.snapshot

  const calls: HandlerFixture['calls'] = {
    startRun: 0,
    getScene: 0,
    getSession: 0,
    getSceneSnapshot: 0,
    streams: []
  }

  const deps: StudioSceneRouteDependencies = {
    getScene: async () => {
      calls.getScene += 1
      return scene
    },
    getSession: async () => {
      calls.getSession += 1
      return session
    },
    getSceneSnapshot: async () => {
      calls.getSceneSnapshot += 1
      if (options?.snapshotThrows) {
        throw new Error('scene persistence down')
      }
      return snapshot as StudioSceneSnapshot | null
    },
    startRun: async () => {
      calls.startRun += 1
      if (options?.startRunStatus === 'conflict') {
        return { status: 'conflict' }
      }
      if (options?.startRunStatus === 'not_found') {
        return { status: 'not_found' }
      }
      if (options?.startRunStatus === 'coordination_unavailable') {
        return { status: 'coordination_unavailable', message: 'Coordination unavailable' }
      }
      return {
        status: 'started',
        run,
        assistantMessage: createStudioAssistantMessage({
          sessionId: session?.id ?? SESSION_ID,
          sceneId: SCENE_A,
          agent: 'builder'
        })
      }
    },
    subscribeExternalEvents: () => () => undefined,
    openEventStream: (input) => {
      calls.streams.push(input)
    },
    resolveEffectiveCustomApiConfig: () => ({
      routeByManimcatKey: false,
      hasUsableCustomApiConfig: false
    })
  }

  return {
    session: session as StudioSession,
    scene: scene as StudioScene,
    run,
    snapshot: snapshot ?? defaultSnapshot,
    deps,
    calls
  }
}

function sceneEvent(sceneId: string | undefined, text = 'hello'): StudioAgentEvent {
  return {
    type: 'assistant_text',
    sessionId: SESSION_ID,
    ...(sceneId === undefined ? {} : { sceneId }),
    runId: 'run-1',
    messageId: 'message-1',
    text
  }
}

function runEvent(sceneId?: string): StudioAgentEvent {
  return {
    type: 'run_updated',
    sessionId: SESSION_ID,
    run: createStudioRun({
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId,
      inputText: 'draw',
      activeAgent: 'builder'
    })
  }
}

function renderEvent(sceneId?: string): StudioAgentEvent {
  return {
    type: 'render_updated',
    sessionId: SESSION_ID,
    render: createStudioRender({
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId,
      kind: 'manim',
      title: 'render',
      concept: 'concept',
      outputMode: 'video',
      error: 'internal failure text'
    })
  }
}

async function readRouteSource(): Promise<string> {
  return readFile(ROUTE_SOURCE_PATH, 'utf8')
}

/** Text of one Express handler, from its route declaration to the next top-level route. */
function handlerBlock(source: string, routeDeclaration: string): string {
  const start = source.indexOf(routeDeclaration)
  assert.ok(start >= 0, `route declaration not found: ${routeDeclaration}`)
  const next = source.indexOf('router.', start + routeDeclaration.length)
  return source.slice(start, next < 0 ? source.length : next)
}

export async function runSceneEventRoutingTests(): Promise<void> {
  // ------------------------------------------------------------ Scene Run API: body and identity

  await run('scene run body parser rejects identity overrides and keeps the control fields', async () => {
    const parsed = parseStudioCreateSceneRunRequest({ inputText: 'draw a circle', projectId: 'project-x' })
    assert.equal(parsed.inputText, 'draw a circle')
    assert.equal(parsed.projectId, 'project-x')
    assert.equal('sessionId' in parsed, false)
    assert.equal('sceneId' in parsed, false)

    assert.throws(() => parseStudioCreateSceneRunRequest({ inputText: 'x', sessionId: 'other-session' }))
    assert.throws(() => parseStudioCreateSceneRunRequest({ inputText: 'x', sceneId: 'other-scene' }))
    assert.throws(() => parseStudioCreateSceneRunRequest({ inputText: 'x', directory: 'C:\\outside' }))
    assert.throws(() => parseStudioCreateSceneRunRequest({ inputText: 42 }))
  })

  await run('scene authorization collapses missing, foreign and foreign-session scenes into one 404', async () => {
    const missing = createFakeResponse()
    const missingResult = await resolveStudioSceneScope({
      res: missing.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      getScene: async () => null,
      getSession: async () => null
    })
    assert.equal(missingResult, null)
    assert.equal(missing.capture.statusCode, 404)

    const foreignOwner = createFakeResponse()
    const foreignOwnerResult = await resolveStudioSceneScope({
      res: foreignOwner.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      getScene: async () => null,
      getSession: async () => ({ id: SESSION_ID } as never)
    })
    assert.equal(foreignOwnerResult, null)

    const foreignSession = createFakeResponse()
    const foreignSessionResult = await resolveStudioSceneScope({
      res: foreignSession.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      getScene: async () => ({ id: SCENE_A, ownerId: OWNER_ID, sessionId: 'another-session' } as never),
      getSession: async () => ({ id: SESSION_ID } as never)
    })
    assert.equal(foreignSessionResult, null)

    // One identical public shape, including the details object.
    assert.deepEqual(missing.capture.payload, foreignOwner.capture.payload)
    assert.deepEqual(missing.capture.payload, foreignSession.capture.payload)
    assert.equal(JSON.stringify(missing.capture.payload).includes('another-session'), false)

    const authorized = createFakeResponse()
    const authorizedResult = await resolveStudioSceneScope({
      res: authorized.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      getScene: async () => ({ id: SCENE_A, ownerId: OWNER_ID, sessionId: SESSION_ID } as never),
      getSession: async () => ({ id: SESSION_ID } as never)
    })
    assert.ok(authorizedResult)
    assert.equal(authorized.capture.statusCode, null)
  })

  await run('scene path parameters are validated before any lookup and malformed shapes are refused', async () => {
    assert.deepEqual(parseStudioScenePathParams({ sessionId: SESSION_ID, sceneId: SCENE_A }), {
      sessionId: SESSION_ID,
      sceneId: SCENE_A
    })
    assert.equal(parseStudioScenePathParams({ sessionId: '', sceneId: SCENE_A }), null)
    assert.equal(parseStudioScenePathParams({ sessionId: SESSION_ID, sceneId: '' }), null)
    assert.equal(parseStudioScenePathParams({ sessionId: ` ${SESSION_ID}`, sceneId: SCENE_A }), null)
    assert.equal(parseStudioScenePathParams({ sessionId: SESSION_ID, sceneId: `${SCENE_A}\u0000` }), null)
    assert.equal(parseStudioScenePathParams({ sessionId: SESSION_ID }), null)
    assert.equal(
      parseStudioScenePathParams({ sessionId: SESSION_ID, sceneId: 's'.repeat(STUDIO_EVENT_SCOPE_ID_MAX_LENGTH + 1) }),
      null
    )
    assert.equal(parseStudioScenePathParams(undefined), null)

    // The route validates the path segments and delegates: no business logic and no runtime call.
    const source = await readRouteSource()
    const createBlock = handlerBlock(source, "router.post('/studio-agent/sessions/:sessionId/scenes/:sceneId/runs'")
    const eventsBlock = handlerBlock(source, "router.get('/studio-agent/sessions/:sessionId/scenes/:sceneId/events'")
    const snapshotBlock = handlerBlock(source, "router.get('/studio-agent/sessions/:sessionId/scenes/:sceneId'")
    assert.ok(createBlock.includes('parseStudioScenePathParams(req.params)'))
    assert.ok(eventsBlock.includes('parseStudioScenePathParams(req.params)'))
    assert.ok(snapshotBlock.includes('parseStudioScenePathParams(req.params)'))
    assert.ok(createBlock.includes('handleStudioSceneRunRequest('))
    assert.ok(eventsBlock.includes('handleStudioSceneEventStreamRequest('))
    assert.equal(/studioRuntime\.(startRun|getScene|getSession|getSceneSnapshot)\(/.test(createBlock), false)
    assert.equal(/studioRuntime\.(startRun|getScene|getSession|getSceneSnapshot)\(/.test(eventsBlock), false)
  })

  await run('the scene run handler returns the accepted DTO and admits exactly once', async () => {
    const fixture = createHandlerFixture()
    const { res, capture } = createFakeResponse()

    await handleStudioSceneRunRequest({
      res,
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: SCENE_A,
      body: { inputText: 'draw a circle' },
      deps: fixture.deps
    })

    assert.equal(capture.statusCode, 202)
    const payload = capture.payload as { ok: boolean; data: Record<string, unknown> }
    assert.equal(payload.ok, true)
    assert.equal((payload.data.run as { id: string }).id, fixture.run.id)
    assert.equal((payload.data.scene as { id: string }).id, SCENE_A)
    assert.equal((payload.data.messages as unknown[]).length, 1)
    assert.equal(fixture.calls.startRun, 1)
    assert.equal(fixture.calls.getScene, 1)
    // The authorized pair is reused, so the Session is read exactly once for the whole request.
    assert.equal(fixture.calls.getSession, 1)
    assert.equal(fixture.calls.getSceneSnapshot, 1)

    const serialized = JSON.stringify(payload)
    assert.equal(serialized.includes('ownerId'), false)
    assert.equal(serialized.includes('internal failure text'), false)
    assert.equal(serialized.includes('sourcePath'), false)
    assert.equal(serialized.includes('scenes/scene_aaaa.py'), false)
  })

  await run('the scene run handler maps 400, 404, 409 and 503 without admitting twice', async () => {
    const identityOverride = createHandlerFixture()
    const identityOverrideResponse = createFakeResponse()
    await handleStudioSceneRunRequest({
      res: identityOverrideResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      body: { inputText: 'draw', sessionId: 'another-session' },
      deps: identityOverride.deps
    })
    assert.equal(identityOverrideResponse.capture.statusCode, 400)
    assert.equal(
      (identityOverrideResponse.capture.payload as { error: { code: string } }).error.code,
      'INVALID_INPUT'
    )
    assert.equal(identityOverride.calls.startRun, 0)
    assert.equal(identityOverride.calls.getScene, 0)

    const blankInput = createHandlerFixture()
    const blankInputResponse = createFakeResponse()
    await handleStudioSceneRunRequest({
      res: blankInputResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      body: { inputText: '   ' },
      deps: blankInput.deps
    })
    assert.equal(blankInputResponse.capture.statusCode, 400)
    assert.equal(blankInput.calls.startRun, 0)

    const unreachable = createHandlerFixture({ scene: null })
    const unreachableResponse = createFakeResponse()
    await handleStudioSceneRunRequest({
      res: unreachableResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      body: { inputText: 'draw' },
      deps: unreachable.deps
    })
    assert.equal(unreachableResponse.capture.statusCode, 404)
    assert.equal(unreachable.calls.startRun, 0)

    const vanished = createHandlerFixture({ startRunStatus: 'not_found' })
    const vanishedResponse = createFakeResponse()
    await handleStudioSceneRunRequest({
      res: vanishedResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      body: { inputText: 'draw' },
      deps: vanished.deps
    })
    assert.equal(vanishedResponse.capture.statusCode, 404)
    assert.equal(vanished.calls.startRun, 1)
    assert.equal(vanished.calls.getSceneSnapshot, 0)

    const conflict = createHandlerFixture({ startRunStatus: 'conflict' })
    const conflictResponse = createFakeResponse()
    await handleStudioSceneRunRequest({
      res: conflictResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      body: { inputText: 'draw' },
      deps: conflict.deps
    })
    assert.equal(conflictResponse.capture.statusCode, 409)
    assert.equal(
      (conflictResponse.capture.payload as { error: { code: string } }).error.code,
      'WORK_CONFLICT'
    )
    assert.equal(conflict.calls.startRun, 1)

    const unavailable = createHandlerFixture({ startRunStatus: 'coordination_unavailable' })
    const unavailableResponse = createFakeResponse()
    await handleStudioSceneRunRequest({
      res: unavailableResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      body: { inputText: 'draw' },
      deps: unavailable.deps
    })
    assert.equal(unavailableResponse.capture.statusCode, 503)
    assert.equal(unavailable.calls.startRun, 1)

    const snapshotFailed = createHandlerFixture({ snapshotThrows: true })
    const snapshotFailedResponse = createFakeResponse()
    await handleStudioSceneRunRequest({
      res: snapshotFailedResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      body: { inputText: 'draw' },
      deps: snapshotFailed.deps
    })
    assert.equal(snapshotFailedResponse.capture.statusCode, 503)
    assert.equal(snapshotFailed.calls.startRun, 1)
  })

  await run('the scene event stream handler authorizes before the transport and filters one exact scene', async () => {
    const fixture = createHandlerFixture()
    const { res, capture } = createFakeResponse()
    const { req } = createFakeRequest()

    await handleStudioSceneEventStreamRequest({
      req,
      res,
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: SCENE_A,
      deps: fixture.deps
    })

    assert.equal(fixture.calls.streams.length, 1)
    const stream = fixture.calls.streams[0]
    assert.ok(stream)
    assert.equal(stream.sessionId, fixture.session.id)
    assert.equal(stream.sceneId, SCENE_A)
    assert.equal(stream.serializeEvent, toPublicStudioSceneEvent)
    assert.ok(stream.filter)
    assert.equal(stream.filter(sceneEvent(SCENE_A)), true)
    assert.equal(stream.filter(sceneEvent(SCENE_B)), false)
    assert.equal(stream.filter(sceneEvent(undefined)), false)
    assert.equal(stream.filter(runEvent(SCENE_A)), true)
    assert.equal(stream.filter(runEvent(undefined)), false)
    // No header was written by the handler itself: the transport owns the SSE protocol.
    assert.equal(capture.headers['Content-Type'], undefined)

    const unreachable = createHandlerFixture({ scene: null })
    const unreachableResponse = createFakeResponse()
    await handleStudioSceneEventStreamRequest({
      req,
      res: unreachableResponse.res,
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      deps: unreachable.deps
    })
    assert.equal(unreachable.calls.streams.length, 0)
    assert.equal(unreachableResponse.capture.statusCode, 404)
  })

  await run('the legacy run route handles the new not_found branch and the handler owns the identity', async () => {
    const routeSource = await readRouteSource()
    const handlerSource = await readFile(HANDLER_SOURCE_PATH, 'utf8')
    const legacyBlock = handlerBlock(routeSource, "router.post('/studio-agent/runs',")

    assert.ok(legacyBlock.includes("started.status === 'not_found'"))
    assert.ok(legacyBlock.includes("sendStudioError(res, 404, 'NOT_FOUND', 'Session not found'"))
    assert.ok(
      legacyBlock.indexOf("started.status === 'not_found'") < legacyBlock.indexOf('started.run.id')
    )
    assert.equal(legacyBlock.includes('sceneId'), false)
    assert.ok(legacyBlock.includes("'A studio run is already active for this session'"))

    // Positive internal contract: the handler is the one place that names the owner, and it hands
    // the authorized identity to both the scope lookup and admission.
    assert.equal(handlerSource.match(/ownerId: input\.ownerId/g)?.length, 2)
    assert.equal(handlerSource.match(/deps\.startRun\(/g)?.length, 1)
    assert.equal(handlerSource.match(/deps\.getSession\(/g)?.length, 1)
    assert.ok(handlerSource.includes('parseStudioCreateSceneRunRequest(input.body)'))
    // No public message may name an internal identity or a lease.
    assert.equal(/lease|Redis|redis/i.test(handlerSource), false)
  })

  // ------------------------------------------------------------------- canonical event scope

  await run('run and render events derive scope from their own payload record', async () => {
    assert.equal(readStudioEventSceneId(runEvent(SCENE_A)), SCENE_A)
    assert.equal(readStudioEventSceneId(runEvent()), undefined)
    assert.equal(readStudioEventSceneId(renderEvent(SCENE_B)), SCENE_B)
    assert.equal(readStudioEventSceneId(renderEvent()), undefined)
    assert.equal(readStudioEventSceneId(sceneEvent(SCENE_A)), SCENE_A)
    assert.equal(readStudioEventSceneId(sceneEvent(undefined)), undefined)
  })

  await run('missing, malformed and mismatched scope fails closed without throwing', async () => {
    const scope = { sessionId: SESSION_ID, sceneId: SCENE_A }

    assert.equal(matchesStudioEventScope(sceneEvent(SCENE_A), scope), true)
    assert.equal(matchesStudioEventScope(sceneEvent(SCENE_B), scope), false)
    assert.equal(matchesStudioEventScope(sceneEvent(undefined), scope), false)
    assert.equal(matchesStudioEventScope(sceneEvent(''), scope), false)
    assert.equal(matchesStudioEventScope(sceneEvent(' scene_aaaa'), scope), false)
    assert.equal(matchesStudioEventScope(sceneEvent(`${SCENE_A}\u0000`), scope), false)
    assert.equal(matchesStudioEventScope(sceneEvent('s'.repeat(STUDIO_EVENT_SCOPE_ID_MAX_LENGTH + 1)), scope), false)
    assert.equal(matchesStudioEventScope(runEvent(SCENE_B), scope), false)
    assert.equal(matchesStudioEventScope(runEvent(SCENE_A), { sessionId: 'other-session', sceneId: SCENE_A }), false)
    assert.equal(matchesStudioEventScope(sceneEvent(SCENE_A), { sessionId: SESSION_ID, sceneId: '' }), false)
    assert.equal(matchesStudioEventScope({ ...runEvent(SCENE_A), sessionId: 'other-session' }, scope), false)

    assert.equal(isStudioEventScopeIdentifier(SCENE_A), true)
    assert.equal(isStudioEventScopeIdentifier(undefined), false)
    assert.equal(isStudioEventScopeIdentifier('   '), false)
  })

  // ------------------------------------------------------- event producers and the transport

  await run('streaming and tool events inherit the active run scene scope', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createStudioSession({
      ownerId: OWNER_ID,
      projectId: 'project-scene-events',
      agentType: 'builder',
      title: 'Scene events',
      directory: 'workspace-scene-events'
    })
    const processor = new StudioRunProcessor({
      messageStore: persistence.messageStore,
      partStore: persistence.partStore
    })
    const bus = new InMemoryStudioEventBus()
    const published: StudioAgentEvent[] = []
    bus.subscribe(session.id, (event) => published.push(event))

    async function* stream(): AsyncGenerator<StudioProcessorStreamEvent> {
      yield { type: 'tool-input-start', id: 'call-1', toolName: 'ls', raw: '{}' }
      yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'ls', input: { path: '.' } }
      yield { type: 'tool-result', toolCallId: 'call-1', title: 'ls', output: 'ok' }
      yield { type: 'text-start' }
      yield { type: 'text-delta', text: 'hello' }
      yield { type: 'text-end' }
    }

    const sceneRun = createStudioRun({
      ownerId: OWNER_ID,
      sessionId: session.id,
      sceneId: SCENE_A,
      inputText: 'draw',
      activeAgent: 'builder'
    })
    await processor.processStream({
      session,
      run: sceneRun,
      assistantMessage: createStudioAssistantMessage({ sessionId: session.id, sceneId: SCENE_A, agent: 'builder' }),
      events: stream(),
      eventBus: bus
    })

    assert.deepEqual(published.map((event) => event.type), [
      'tool_input_start',
      'tool_call',
      'tool_result',
      'assistant_text'
    ])
    assert.ok(published.every((event) => readStudioEventSceneId(event) === SCENE_A))

    published.length = 0
    const legacyRun = createStudioRun({
      ownerId: OWNER_ID,
      sessionId: session.id,
      inputText: 'draw',
      activeAgent: 'builder'
    })
    await processor.processStream({
      session,
      run: legacyRun,
      assistantMessage: createStudioAssistantMessage({ sessionId: session.id, agent: 'builder' }),
      events: stream(),
      eventBus: bus
    })

    // A Legacy Run adds no Scene key at all, so its payload stays byte-identical.
    assert.ok(published.every((event) => readStudioEventSceneId(event) === undefined))
    assert.ok(published.every((event) => !('sceneId' in event)))
    const firstAdapted = adaptStudioEvent(published[0]!)
    assert.ok(firstAdapted)
    assert.equal(firstAdapted.properties.sceneId, undefined)
    assert.equal('sceneId' in firstAdapted.properties, false)
    assert.equal(firstAdapted.properties.sessionId, session.id)
  })

  await run('envelope round-trip preserves the scene scope and rejects malformed scope without payload leakage', async () => {
    const sceneEnvelope = createStudioEventEnvelope({
      event: sceneEvent(SCENE_A),
      originId: 'origin-1',
      eventId: 'event-1',
      publishedAt: '2026-01-01T00:00:00.000Z'
    })
    const decoded = decodeStudioEventEnvelope(encodeStudioEventEnvelope(sceneEnvelope))
    assert.equal(decoded.ok, true)
    assert.ok(decoded.ok)
    assert.equal(decoded.envelope.version, 1)
    assert.equal(readStudioEventSceneId(decoded.envelope.event), SCENE_A)

    const legacyEnvelope = createStudioEventEnvelope({
      event: sceneEvent(undefined),
      originId: 'origin-1'
    })
    const legacyDecoded = decodeStudioEventEnvelope(encodeStudioEventEnvelope(legacyEnvelope))
    assert.ok(legacyDecoded.ok)
    assert.equal(readStudioEventSceneId(legacyDecoded.envelope.event), undefined)

    const runPayload = JSON.parse(encodeStudioEventEnvelope(createStudioEventEnvelope({
      event: runEvent(SCENE_A),
      originId: 'origin-1'
    })))
    const runDecoded = decodeStudioEventEnvelope(JSON.stringify(runPayload))
    assert.ok(runDecoded.ok)
    assert.equal(readStudioEventSceneId(runDecoded.envelope.event), SCENE_A)

    const malformedStreaming = JSON.parse(encodeStudioEventEnvelope(createStudioEventEnvelope({
      event: sceneEvent(SCENE_A),
      originId: 'origin-1'
    })))
    malformedStreaming.event.sceneId = '  '
    const rejectedStreaming = decodeStudioEventEnvelope(JSON.stringify(malformedStreaming))
    assert.equal(rejectedStreaming.ok, false)
    assert.ok(!rejectedStreaming.ok)
    assert.equal(rejectedStreaming.reason.includes('  '), false)

    const malformedRun = JSON.parse(encodeStudioEventEnvelope(createStudioEventEnvelope({
      event: runEvent(SCENE_A),
      originId: 'origin-1'
    })))
    malformedRun.event.run.sceneId = 42
    const rejectedRun = decodeStudioEventEnvelope(JSON.stringify(malformedRun))
    assert.equal(rejectedRun.ok, false)
    assert.ok(!rejectedRun.ok)
    assert.equal(rejectedRun.reason.includes('42'), false)
  })

  await run('the scene public projection keeps private paths, diagnostics and internal errors out', async () => {
    const scene = createStudioScene({
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      id: SCENE_A,
      position: 0,
      sourcePath: 'D:/private/source.py'
    })
    const render = createStudioRender({
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      kind: 'plot',
      title: 'render',
      concept: 'concept',
      outputMode: 'image',
      status: 'failed',
      sourcePath: 'D:/private/source.py',
      error: 'internal failure text',
      attachments: [
        { kind: 'file', path: 'D:/private/out.png', name: 'out.png' },
        { kind: 'file', path: 'data:image/png;base64,AAAA', name: 'plot.png', mimeType: 'image/png' }
      ],
      metadata: {
        scriptPath: 'scenes/out.py',
        imagePaths: ['scenes/out.png'],
        imageCount: 1,
        sourcePath: 'D:/private/source.py',
        workspaceDirectory: 'D:/private',
        diagnostics: [{ message: 'raw diagnostic' }]
      }
    })
    const run: StudioRun = {
      ...createStudioRun({
        ownerId: OWNER_ID,
        sessionId: SESSION_ID,
        sceneId: SCENE_A,
        inputText: 'draw',
        activeAgent: 'builder'
      }),
      status: 'failed',
      error: 'internal failure text',
      tokenUsage: { promptTokens: 3, completionTokens: 4, totalTokens: 7, measuredCalls: 1, unmeasuredCalls: 0 }
    }

    const assistant = createStudioAssistantMessage({ sessionId: SESSION_ID, sceneId: SCENE_A, agent: 'builder' })
    const textPart: StudioTextPart = {
      id: 'part-text',
      messageId: assistant.id,
      sessionId: SESSION_ID,
      type: 'text',
      text: 'All done.',
      time: { start: 0, end: 1 }
    }
    const completedPart: StudioToolPart = {
      ...createStudioToolPart({
        messageId: assistant.id,
        sessionId: SESSION_ID,
        tool: 'write',
        callId: 'call-1',
        raw: JSON.stringify({ path: 'D:/private/source.py' })
      }),
      state: {
        status: 'completed',
        input: { path: 'D:/private/source.py' },
        output: 'File written successfully: scenes/scene_aaaa.py',
        title: 'Wrote scenes/scene_aaaa.py',
        time: { start: 1, end: 2 },
        attachments: [{ kind: 'file', path: 'D:/private/out.png' }],
        metadata: {
          path: 'scenes/scene_aaaa.py',
          bytes: 12,
          sourcePath: 'D:/private/source.py',
          diagnostics: [{ message: 'raw diagnostic' }]
        }
      }
    }
    const failedPart: StudioToolPart = {
      ...createStudioToolPart({
        messageId: assistant.id,
        sessionId: SESSION_ID,
        tool: 'write',
        callId: 'call-2',
        raw: JSON.stringify({ path: 'D:/private/source.py' })
      }),
      state: {
        status: 'error',
        input: { path: 'D:/private/source.py' },
        error: 'ENOENT: D:/private/source.py',
        metadata: { denialReason: 'not_authorized_target', sourcePath: 'D:/private/source.py' },
        time: { start: 2, end: 3 }
      }
    }
    const snapshot: StudioSceneSnapshot = {
      scene,
      messages: [
        createStudioUserMessage({ sessionId: SESSION_ID, sceneId: SCENE_A, text: 'draw' }),
        { ...assistant, parts: [textPart, completedPart, failedPart] }
      ],
      runs: [run],
      renders: [render]
    }

    const projection = toPublicStudioSceneSnapshot(snapshot)
    const serialized = JSON.stringify(projection)
    for (const leak of [
      'D:/private',
      'internal failure text',
      'ENOENT',
      'raw diagnostic',
      'ownerId',
      'sourcePath',
      'workspaceDirectory',
      'diagnostics'
    ]) {
      assert.equal(serialized.includes(leak), false, `scene projection leaked: ${leak}`)
    }

    // Public facts survive: status, token usage, user-facing text and playable media.
    assert.equal(projection.runs[0]?.status, 'failed')
    assert.deepEqual(projection.runs[0]?.tokenUsage, {
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
      measuredCalls: 1,
      unmeasuredCalls: 0
    })
    assert.equal(projection.renders[0]?.status, 'failed')
    assert.deepEqual(projection.renders[0]?.attachments, [
      { kind: 'file', path: 'data:image/png;base64,AAAA', name: 'plot.png', mimeType: 'image/png' }
    ])
    assert.deepEqual(projection.renders[0]?.metadata, {
      scriptPath: 'scenes/out.py',
      imagePaths: ['scenes/out.png'],
      imageCount: 1
    })

    const publicAssistant = projection.messages[1]
    assert.ok(publicAssistant)
    assert.equal(publicAssistant.role, 'assistant')
    assert.ok(publicAssistant.role === 'assistant')
    assert.equal(publicAssistant.parts.length, 3)
    const publicText = publicAssistant.parts[0]
    assert.ok(publicText)
    assert.equal(publicText.type === 'text' ? publicText.text : '', 'All done.')
    const publicCompleted = publicAssistant.parts[1]
    assert.ok(publicCompleted)
    assert.ok(publicCompleted.type === 'tool')
    assert.equal(publicCompleted.state.status, 'completed')
    assert.equal(publicCompleted.state.output?.includes('scenes/scene_aaaa.py'), true)
    assert.equal('input' in publicCompleted.state, false)
    assert.deepEqual(publicCompleted.state.metadata, { path: 'scenes/scene_aaaa.py', bytes: 12 })
    const publicFailed = publicAssistant.parts[2]
    assert.ok(publicFailed)
    assert.ok(publicFailed.type === 'tool')
    assert.equal(publicFailed.state.status, 'error')
    assert.equal('error' in publicFailed.state, false)
    assert.equal('input' in publicFailed.state, false)

    // The projection copies: the source records keep their internal fields untouched.
    assert.equal(render.error, 'internal failure text')
    assert.equal(render.sourcePath, 'D:/private/source.py')
    assert.equal(render.attachments?.[0]?.path, 'D:/private/out.png')
    assert.equal((completedPart.state as { metadata?: Record<string, unknown> }).metadata?.sourcePath, 'D:/private/source.py')

    // The legacy Session SSE contract is unchanged: it keeps the internal error text.
    const legacyEvent = toPublicStudioEvent({
      type: 'render.updated',
      properties: { sessionId: SESSION_ID, render }
    })
    assert.equal((legacyEvent.properties.render as { error?: string }).error, 'internal failure text')

    // A Scene tool.result event: public status and output survive, internal text and private media do not.
    const sceneToolEvent = toPublicStudioSceneEvent({
      type: 'tool.result',
      properties: {
        sessionId: SESSION_ID,
        sceneId: SCENE_A,
        runId: 'run-1',
        messageId: assistant.id,
        toolName: 'write',
        callId: 'call-1',
        status: 'failed',
        title: 'Wrote',
        output: 'scenes/scene_aaaa.py',
        error: 'ENOENT: D:/private/source.py',
        metadata: {
          path: 'scenes/scene_aaaa.py',
          diagnostics: [{ message: 'raw diagnostic' }],
          sourcePath: 'D:/private/source.py'
        },
        attachments: [{ kind: 'file', path: 'D:/private/out.png', name: 'out.png' }]
      }
    })
    const eventSerialized = JSON.stringify(sceneToolEvent)
    for (const leak of ['D:/private', 'ENOENT', 'raw diagnostic', 'sourcePath', 'diagnostics']) {
      assert.equal(eventSerialized.includes(leak), false, `scene tool event leaked: ${leak}`)
    }
    assert.equal(sceneToolEvent.properties.status, 'failed')
    // A failed Tool publishes no result text at all; the public status is the whole story.
    assert.equal('output' in sceneToolEvent.properties, false)
    assert.equal(sceneToolEvent.properties.sceneId, SCENE_A)
    assert.deepEqual(sceneToolEvent.properties.metadata, { path: 'scenes/scene_aaaa.py' })
    assert.equal('attachments' in sceneToolEvent.properties, false)
    assert.equal('error' in sceneToolEvent.properties, false)
  })

  await run('a completed static check publishes a count summary instead of its raw diagnostics', async () => {
    const assistant = createStudioAssistantMessage({ sessionId: SESSION_ID, sceneId: SCENE_A, agent: 'builder' })
    const diagnosticLine = 'manim:12:3 ENOENT: D:/private/scene_0001.py raw diagnostic exploded'
    const staticCheckPart: StudioToolPart = {
      ...createStudioToolPart({
        messageId: assistant.id,
        sessionId: SESSION_ID,
        tool: 'static-check',
        callId: 'call-static',
        raw: JSON.stringify({ path: 'scenes/scene_0001.py' })
      }),
      state: {
        status: 'completed',
        input: { path: 'scenes/scene_0001.py' },
        output: diagnosticLine,
        title: 'Static check scenes/scene_0001.py',
        time: { start: 0, end: 1 },
        metadata: {
          path: 'scenes/scene_0001.py',
          kind: 'manim',
          outputMode: 'video',
          diagnosticCount: 2,
          truncated: false,
          diagnostics: [{ message: diagnosticLine }]
        }
      }
    }
    const scene = createStudioScene({
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      id: SCENE_A,
      position: 0,
      sourcePath: 'scenes/scene_0001.py'
    })
    const snapshot: StudioSceneSnapshot = {
      scene,
      messages: [
        createStudioUserMessage({ sessionId: SESSION_ID, sceneId: SCENE_A, text: 'check' }),
        { ...assistant, parts: [staticCheckPart] }
      ],
      runs: [],
      renders: []
    }

    const projection = toPublicStudioSceneSnapshot(snapshot)
    const serialized = JSON.stringify(projection)
    for (const leak of ['ENOENT', 'D:/private', 'raw diagnostic', 'diagnostics']) {
      assert.equal(serialized.includes(leak), false, `static check projection leaked: ${leak}`)
    }

    const publicPart = projection.messages[1]
    assert.ok(publicPart && publicPart.role === 'assistant')
    const publicTool = publicPart.parts[0]
    assert.ok(publicTool && publicTool.type === 'tool')
    assert.equal(publicTool.state.status, 'completed')
    // The stable summary replaces the raw lines; the public counts and the title survive.
    assert.equal(publicTool.state.output, 'Static check completed: 2 diagnostics.')
    assert.equal(publicTool.state.title, 'Static check scenes/scene_0001.py')
    assert.equal(publicTool.state.metadata?.diagnosticCount, 2)
    assert.equal(publicTool.state.metadata?.path, 'scenes/scene_0001.py')

    // The internal record is copied, never rewritten: the model and the store keep the raw lines.
    assert.equal(staticCheckPart.state.status === 'completed' ? staticCheckPart.state.output : '', diagnosticLine)
    assert.deepEqual(
      (staticCheckPart.state as { metadata?: Record<string, unknown> }).metadata?.diagnostics,
      [{ message: diagnosticLine }]
    )

    // A zero count has its own stable wording and a missing count stays honest.
    const zero = toPublicStudioSceneToolState(
      {
        status: 'completed',
        input: { path: 'scenes/scene_0001.py' },
        output: diagnosticLine,
        title: 'Static check scenes/scene_0001.py',
        time: { start: 0, end: 1 },
        metadata: { path: 'scenes/scene_0001.py', diagnosticCount: 0 }
      },
      'static-check'
    )
    assert.equal(zero.output, 'Static check completed: no diagnostics.')
    assert.equal(
      toPublicStudioSceneToolState(
        {
          status: 'completed',
          input: {},
          output: diagnosticLine,
          title: 'Static check scenes/scene_0001.py',
          time: { start: 0, end: 1 }
        },
        'static-check'
      ).output,
      'Static check completed.'
    )
  })

  await run('static-check through the scene event stream and the legacy stream split cleanly', async () => {
    const diagnosticLine = 'manim:9:1 ENOENT: D:/private/scene_0002.py raw diagnostic'
    const completed: StudioExternalEvent = {
      type: 'tool.result',
      properties: {
        sessionId: SESSION_ID,
        sceneId: SCENE_A,
        runId: 'run-1',
        messageId: 'message-1',
        toolName: 'static-check',
        callId: 'call-static',
        status: 'completed',
        title: 'Static check scenes/scene_0002.py',
        output: diagnosticLine,
        metadata: { path: 'scenes/scene_0002.py', diagnosticCount: 1, diagnostics: [{ message: diagnosticLine }] }
      }
    }

    const sceneEventProjected = toPublicStudioSceneEvent(completed)
    const sceneSerialized = JSON.stringify(sceneEventProjected)
    for (const leak of ['ENOENT', 'D:/private', 'raw diagnostic', 'diagnostics']) {
      assert.equal(sceneSerialized.includes(leak), false, `scene static check event leaked: ${leak}`)
    }
    assert.equal(sceneEventProjected.properties.output, 'Static check completed: 1 diagnostic.')
    assert.equal(sceneEventProjected.properties.sceneId, SCENE_A)
    assert.deepEqual(sceneEventProjected.properties.metadata, {
      path: 'scenes/scene_0002.py',
      diagnosticCount: 1
    })

    // A failed static check publishes neither result text nor the internal error.
    const failed: StudioExternalEvent = {
      type: 'tool.result',
      properties: {
        sessionId: SESSION_ID,
        sceneId: SCENE_A,
        runId: 'run-1',
        messageId: 'message-1',
        toolName: 'static-check',
        callId: 'call-static',
        status: 'failed',
        output: 'ENOENT: D:/private/scene_0002.py',
        error: 'ENOENT: D:/private/scene_0002.py'
      }
    }
    const failedProjected = toPublicStudioSceneEvent(failed)
    assert.equal('output' in failedProjected.properties, false)
    assert.equal('error' in failedProjected.properties, false)
    assert.equal(failedProjected.properties.status, 'failed')

    // The legacy Session stream keeps the raw diagnostics of the same event.
    const legacy = toPublicStudioEvent(completed)
    assert.equal(legacy.properties.output, diagnosticLine)
    assert.deepEqual(legacy.properties.metadata, completed.properties.metadata)

    // Every other Tool keeps its compatibility passthrough: read output is the user's work result.
    const readEvent: StudioExternalEvent = {
      type: 'tool.result',
      properties: {
        sessionId: SESSION_ID,
        sceneId: SCENE_A,
        runId: 'run-1',
        messageId: 'message-1',
        toolName: 'read',
        callId: 'call-read',
        status: 'completed',
        output: '1 | import manim\n2 | # scenes/scene_0001.py'
      }
    }
    assert.equal(toPublicStudioSceneEvent(readEvent).properties.output, readEvent.properties.output)
  })

  // --------------------------------------------------------------------------- SSE delivery

  await run('exact scene events pass and the session stream keeps its behavior', async () => {
    const bus = new InMemoryStudioEventBus()
    const { req, close } = createFakeRequest()
    const { res, capture } = createFakeResponse()

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: (sessionId, listener, options) => {
        assert.equal(sessionId, SESSION_ID)
        return bus.subscribe(sessionId, (event) => {
          if (!options?.filter || options.filter(event)) {
            listener(adaptStudioEvent(event)!)
          }
        }) as unknown as () => void
      },
      filter: (event) => matchesStudioEventScope(event, { sessionId: SESSION_ID, sceneId: SCENE_A }),
      serializeEvent: toPublicStudioSceneEvent
    })

    assert.equal(capture.headers['Content-Type'], 'text/event-stream')
    assert.equal(capture.headers['Cache-Control'], 'no-cache, no-transform')
    assert.equal(capture.headers.Connection, 'keep-alive')
    assert.ok(capture.chunks[0]?.includes('event: studio.connected'))

    bus.publish(sceneEvent(SCENE_A, 'mine'))
    bus.publish(sceneEvent(SCENE_B, 'sibling'))
    bus.publish(sceneEvent(undefined, 'legacy'))
    bus.publish(runEvent(SCENE_B))
    bus.publish(runEvent(SCENE_A))

    const delivered = capture.chunks.join('')
    assert.ok(delivered.includes('mine'))
    assert.equal(delivered.includes('sibling'), false)
    assert.equal(delivered.includes('legacy'), false)
    assert.equal(delivered.includes('event: assistant.text\n'), true)
    assert.equal((delivered.match(/event: assistant\.text\n/g) ?? []).length, 1)
    assert.equal((delivered.match(/event: run\.updated\n/g) ?? []).length, 1)

    close()
    assert.equal(capture.ended, true)
  })

  await run('the session stream delivers every session event and releases exactly one subscription', async () => {
    const bus = new InMemoryStudioEventBus()
    const { req, close } = createFakeRequest()
    const { res, capture } = createFakeResponse()

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      subscribeExternalEvents: (sessionId, listener) => bus.subscribe(sessionId, (event) => {
        const adapted = adaptStudioEvent(event)
        if (adapted) {
          listener(adapted)
        }
      }),
      serializeEvent: toPublicStudioEvent
    })

    bus.publish(sceneEvent(SCENE_A, 'scene text'))
    bus.publish(sceneEvent(undefined, 'legacy text'))
    bus.publish(renderEvent(SCENE_A))

    const delivered = capture.chunks.join('')
    assert.ok(delivered.includes('scene text'))
    assert.ok(delivered.includes('legacy text'))
    assert.ok(delivered.includes('event: render.updated'))

    close()
    // Second close must be a no-op: the interval and the subscription are released once.
    close()
    assert.equal(capture.ended, true)
  })

  await run('two concurrent scenes never cross-deliver and unsubscribe once each', async () => {
    const bus = new InMemoryStudioEventBus()
    const sceneAStream = createFakeResponse()
    const sceneBStream = createFakeResponse()
    const sceneARequest = createFakeRequest()
    const sceneBRequest = createFakeRequest()
    const unsubscribes = { a: 0, b: 0 }

    openStudioAgentEventStream({
      req: sceneARequest.req,
      res: sceneAStream.res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: (sessionId, listener, options) => {
        const unsubscribe = bus.subscribe(sessionId, (event) => {
          if (!options?.filter || options.filter(event)) {
            listener(adaptStudioEvent(event)!)
          }
        })
        return () => {
          unsubscribes.a += 1
          unsubscribe()
        }
      },
      filter: (event) => matchesStudioEventScope(event, { sessionId: SESSION_ID, sceneId: SCENE_A }),
      serializeEvent: toPublicStudioSceneEvent
    })
    openStudioAgentEventStream({
      req: sceneBRequest.req,
      res: sceneBStream.res,
      sessionId: SESSION_ID,
      sceneId: SCENE_B,
      subscribeExternalEvents: (sessionId, listener, options) => {
        const unsubscribe = bus.subscribe(sessionId, (event) => {
          if (!options?.filter || options.filter(event)) {
            listener(adaptStudioEvent(event)!)
          }
        })
        return () => {
          unsubscribes.b += 1
          unsubscribe()
        }
      },
      filter: (event) => matchesStudioEventScope(event, { sessionId: SESSION_ID, sceneId: SCENE_B }),
      serializeEvent: toPublicStudioSceneEvent
    })

    bus.publish(sceneEvent(SCENE_A, 'for A'))
    bus.publish(sceneEvent(SCENE_B, 'for B'))
    bus.publish(runEvent(SCENE_A))
    bus.publish(runEvent(SCENE_B))

    const deliveredA = sceneAStream.capture.chunks.join('')
    const deliveredB = sceneBStream.capture.chunks.join('')
    assert.ok(deliveredA.includes('for A'))
    assert.equal(deliveredA.includes('for B'), false)
    assert.ok(deliveredB.includes('for B'))
    assert.equal(deliveredB.includes('for A'), false)
    assert.equal((deliveredA.match(/event: run\.updated\n/g) ?? []).length, 1)
    assert.equal((deliveredB.match(/event: run\.updated\n/g) ?? []).length, 1)

    sceneARequest.close()
    sceneBRequest.close()
    assert.deepEqual(unsubscribes, { a: 1, b: 1 })
  })

  await run('a subscribe failure during setup still releases the timer and ends the stream once', async () => {
    const fakeClock = createFakeClock()
    const { req, close } = createFakeRequest()
    const { res, capture } = createFakeResponse()

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: () => {
        throw new Error('event bus unavailable')
      },
      serializeEvent: toPublicStudioSceneEvent,
      clock: fakeClock.clock
    })

    assert.equal(capture.headers['Content-Type'], 'text/event-stream')
    assert.equal(capture.ended, true)
    assert.equal(fakeClock.liveIntervals(), 0)
    // The connected frame is never announced after a failed setup.
    assert.equal(capture.chunks.some((chunk) => chunk.includes('studio.connected')), false)

    close()
    assert.equal(capture.endCount, 1)
  })

  await run('a connected frame write failure releases the subscription exactly once', async () => {
    const fakeClock = createFakeClock()
    let unsubscribed = 0
    const { req, close } = createFakeRequest()
    const { res, capture } = createFakeResponse({ failWriteAt: 0 })

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: () => () => {
        unsubscribed += 1
      },
      serializeEvent: toPublicStudioSceneEvent,
      clock: fakeClock.clock
    })

    assert.equal(unsubscribed, 1)
    assert.equal(capture.ended, true)
    assert.equal(fakeClock.liveIntervals(), 0)
    assert.equal(fakeClock.cleared(), 1)

    close()
    close()
    assert.equal(unsubscribed, 1)
    assert.equal(capture.endCount, 1)
  })

  await run('an event write failure tears the stream down and never leaves a live timer', async () => {
    const fakeClock = createFakeClock()
    let unsubscribed = 0
    let deliver: ((event: unknown) => void) | undefined
    const { req, close } = createFakeRequest()
    // The connected frame is allowed through; the first delivered event fails.
    const { res, capture } = createFakeResponse({ failWriteAt: 2 })

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: (sessionId, listener) => {
        assert.equal(sessionId, SESSION_ID)
        deliver = listener as unknown as (event: unknown) => void
        return () => {
          unsubscribed += 1
        }
      },
      serializeEvent: toPublicStudioSceneEvent,
      clock: fakeClock.clock
    })

    assert.ok(deliver)
    deliver(adaptStudioEvent(sceneEvent(SCENE_A, 'boom'))!)
    assert.equal(unsubscribed, 1)
    assert.equal(capture.ended, true)
    assert.equal(fakeClock.liveIntervals(), 0)

    close()
    assert.equal(unsubscribed, 1)
    assert.equal(capture.endCount, 1)
  })

  await run('a duplicate close, an abort and a response error release the same single subscription', async () => {
    const fakeClock = createFakeClock()
    let unsubscribed = 0
    const { req, close, abort } = createFakeRequest()
    const { res, capture, emitClose, emitError } = createFakeResponse()

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: () => () => {
        unsubscribed += 1
      },
      serializeEvent: toPublicStudioSceneEvent,
      clock: fakeClock.clock
    })

    assert.equal(fakeClock.liveIntervals(), 1)
    const chunksBefore = capture.chunks.length
    close()
    abort()
    emitError()
    emitClose()
    assert.equal(unsubscribed, 1)
    assert.equal(capture.endCount, 1)

    // A heartbeat that was scheduled before the teardown cannot write into a closed stream.
    fakeClock.tick()
    assert.equal(fakeClock.liveIntervals(), 0)
    assert.equal(capture.chunks.length, chunksBefore)
  })

  await run('a throwing event serializer tears the stream down instead of escaping', async () => {
    const fakeClock = createFakeClock()
    let unsubscribed = 0
    let deliver: ((event: unknown) => void) | undefined
    const { req, close } = createFakeRequest()
    const { res, capture } = createFakeResponse()

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: (_sessionId, listener) => {
        deliver = listener as unknown as (event: unknown) => void
        return () => {
          unsubscribed += 1
        }
      },
      serializeEvent: () => {
        throw new Error('projection failed')
      },
      clock: fakeClock.clock
    })

    assert.ok(deliver)
    // Projection lives inside the write failure boundary: the throw must not reach the publisher.
    deliver(adaptStudioEvent(sceneEvent(SCENE_A, 'boom'))!)
    assert.equal(unsubscribed, 1)
    assert.equal(capture.ended, true)
    assert.equal(fakeClock.liveIntervals(), 0)
    assert.equal(fakeClock.cleared(), 1)

    close()
    close()
    assert.equal(unsubscribed, 1)
    assert.equal(capture.endCount, 1)
  })

  await run('a JSON encoding failure during delivery tears the stream down', async () => {
    const fakeClock = createFakeClock()
    let unsubscribed = 0
    let deliver: ((event: unknown) => void) | undefined
    const { req, close } = createFakeRequest()
    const { res, capture } = createFakeResponse()

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      subscribeExternalEvents: (_sessionId, listener) => {
        deliver = listener as unknown as (event: unknown) => void
        return () => {
          unsubscribed += 1
        }
      },
      serializeEvent: () => {
        const circular: Record<string, unknown> = { type: 'studio.circular' }
        circular.self = circular
        return circular as unknown as StudioExternalEvent
      },
      clock: fakeClock.clock
    })

    assert.ok(deliver)
    deliver(adaptStudioEvent(sceneEvent(SCENE_A, 'boom'))!)
    assert.equal(unsubscribed, 1)
    assert.equal(capture.ended, true)
    assert.equal(fakeClock.liveIntervals(), 0)

    close()
    assert.equal(unsubscribed, 1)
    assert.equal(capture.endCount, 1)
  })

  await run('a synchronous delivery failure before subscribe returns releases it exactly once', async () => {
    const fakeClock = createFakeClock()
    let unsubscribed = 0
    const { req, close } = createFakeRequest()
    const { res, capture } = createFakeResponse()

    openStudioAgentEventStream({
      req,
      res,
      sessionId: SESSION_ID,
      sceneId: SCENE_A,
      // The bus replays a buffered event synchronously, before it hands back the unsubscribe, and
      // that delivery fails: the teardown runs while the subscription is still unknown to the
      // helper, so the returned release must be consumed immediately.
      subscribeExternalEvents: (_sessionId, listener) => {
        listener(adaptStudioEvent(sceneEvent(SCENE_A, 'buffered'))!)
        return () => {
          unsubscribed += 1
        }
      },
      serializeEvent: () => {
        throw new Error('projection failed')
      },
      clock: fakeClock.clock
    })

    assert.equal(unsubscribed, 1)
    assert.equal(capture.ended, true)
    assert.equal(fakeClock.liveIntervals(), 0)
    // A closed stream is never announced, and no further resource is installed.
    assert.equal(capture.chunks.some((chunk) => chunk.includes('studio.connected')), false)

    close()
    close()
    assert.equal(unsubscribed, 1)
    assert.equal(capture.endCount, 1)
  })
}
