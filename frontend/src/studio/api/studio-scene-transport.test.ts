import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildStudioSceneRunPath,
  createStudioScene,
  createStudioSceneRun,
  getStudioSceneSnapshot,
  reorderStudioScenes,
} from './studio-agent-api'
import { buildStudioEventStreamUrl, resolveStudioEventStreamScope } from './studio-agent-events'
import {
  readStudioExternalEventSceneId,
  type StudioExternalEvent,
} from '../protocol/studio-agent-events'

/**
 * Task 11B2C transport contract: the Scene Run endpoint, the Scene stream URL and the defensive
 * scope parser. No React shell, reducer or store is involved — Task 11C consumes this surface.
 */
describe('studio scene transport contract', () => {
  afterEach(() => {
    // `vi.restoreAllMocks` does not undo `vi.stubGlobal`, so the global stub is released explicitly.
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('keeps the session stream URL byte-identical to the pre-scene behavior', () => {
    const signal = new AbortController().signal

    expect(buildStudioEventStreamUrl({ kind: 'session', sessionId: 'session 1' })).toBe(
      '/api/studio-agent/sessions/session%201/events',
    )
    expect(buildStudioEventStreamUrl({ kind: 'session', sessionId: 'session/1' })).toBe(
      '/api/studio-agent/sessions/session%2F1/events',
    )

    // The legacy option shape (sessionId, no scope) resolves to the same Session scope.
    expect(
      resolveStudioEventStreamScope({ sessionId: 'session/1', signal, onEvent: () => {} }),
    ).toEqual({ kind: 'session', sessionId: 'session/1' })
    expect(
      buildStudioEventStreamUrl(
        resolveStudioEventStreamScope({ sessionId: 'session/1', signal, onEvent: () => {} }),
      ),
    ).toBe('/api/studio-agent/sessions/session%2F1/events')
  })

  it('builds the nested scene stream URL with both identifiers encoded', () => {
    expect(
      buildStudioEventStreamUrl({ kind: 'scene', sessionId: 'session 1', sceneId: 'scene/2' }),
    ).toBe('/api/studio-agent/sessions/session%201/scenes/scene%2F2/events')
    expect(buildStudioEventStreamUrl({ kind: 'scene', sessionId: 's', sceneId: 'plain' })).toBe(
      '/api/studio-agent/sessions/s/scenes/plain/events',
    )
  })

  it('posts a scene run to the nested URL and keeps identity out of the body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { scene: { id: 'scene-1' }, messages: [], runs: [], renders: [], run: { id: 'run-1' } },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await createStudioSceneRun('session-1', 'scene-1', {
      inputText: 'draw',
      projectId: 'project-1',
    })

    expect(response.run).toEqual({ id: 'run-1' })
    expect(response.messages).toEqual([])
    expect(response.runs).toEqual([])

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/studio-agent/sessions/session-1/scenes/scene-1/runs')
    expect(init.method).toBe('POST')

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({ inputText: 'draw', projectId: 'project-1' })
    expect('sessionId' in body).toBe(false)
    expect('sceneId' in body).toBe(false)

    expect(buildStudioSceneRunPath('session 1', 'scene/2')).toBe(
      '/sessions/session%201/scenes/scene%2F2/runs',
    )
  })

  it('parses the scene scope of supported frames and ignores legacy, connected and unknown ones', () => {
    const sceneText: StudioExternalEvent = {
      type: 'assistant.text',
      properties: { sessionId: 's', sceneId: 'scene-1', runId: 'r', messageId: 'm', text: 'hi' },
    }
    expect(readStudioExternalEventSceneId(sceneText)).toBe('scene-1')

    const legacyText: StudioExternalEvent = {
      type: 'assistant.text',
      properties: { sessionId: 's', runId: 'r', messageId: 'm', text: 'hi' },
    }
    expect(readStudioExternalEventSceneId(legacyText)).toBeUndefined()

    const runEvent: StudioExternalEvent = {
      type: 'run.updated',
      properties: {
        sessionId: 's',
        run: {
          id: 'r',
          sessionId: 's',
          sceneId: 'scene-2',
          status: 'running',
          inputText: '',
          activeAgent: 'builder',
          createdAt: 'now',
        },
      },
    }
    expect(readStudioExternalEventSceneId(runEvent)).toBe('scene-2')

    const legacyRunEvent: StudioExternalEvent = {
      type: 'run.updated',
      properties: {
        sessionId: 's',
        run: {
          id: 'r',
          sessionId: 's',
          status: 'running',
          inputText: '',
          activeAgent: 'builder',
          createdAt: 'now',
        },
      },
    }
    expect(readStudioExternalEventSceneId(legacyRunEvent)).toBeUndefined()

    const renderEvent: StudioExternalEvent = {
      type: 'render.updated',
      properties: {
        sessionId: 's',
        render: {
          id: 'render-1',
          sessionId: 's',
          sceneId: 'scene-3',
          kind: 'plot',
          title: 'render',
          status: 'queued',
          concept: 'c',
          outputMode: 'image',
          createdAt: 'now',
          updatedAt: 'now',
        },
      },
    }
    expect(readStudioExternalEventSceneId(renderEvent)).toBe('scene-3')

    const toolResult: StudioExternalEvent = {
      type: 'tool.result',
      properties: {
        sessionId: 's',
        sceneId: 'scene-4',
        runId: 'r',
        messageId: 'm',
        toolName: 'static-check',
        callId: 'call-1',
        status: 'completed',
      },
    }
    expect(readStudioExternalEventSceneId(toolResult)).toBe('scene-4')

    // A frame that carries no scope at all never invents one.
    expect(
      readStudioExternalEventSceneId({
        type: 'studio.connected',
        properties: { timestamp: 1 },
      }),
    ).toBeUndefined()
    expect(readStudioExternalEventSceneId({ type: 'studio.heartbeat', properties: {} })).toBeUndefined()
  })

  it('creates a Scene with an empty body and reads only the created Scene', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, data: { scene: { id: 'scene-2', sessionId: 'session/1', position: 1 } } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const scene = await createStudioScene('session/1')

    expect(scene).toEqual({ id: 'scene-2', sessionId: 'session/1', position: 1 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/studio-agent/sessions/session%2F1/scenes')
    expect(init.method).toBe('POST')
    // The client never guesses a Scene identity, a directory or a file path.
    expect(JSON.parse(String(init.body))).toEqual({})
  })

  it('reorders Scenes with the ids it was given and forwards an AbortSignal', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, data: { scenes: [{ id: 'scene-2', sessionId: 's', position: 0 }] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const scenes = await reorderStudioScenes('session-1', ['scene-2', 'scene-1'], {
      signal: controller.signal,
    })

    expect(scenes).toEqual([{ id: 'scene-2', sessionId: 's', position: 0 }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/studio-agent/sessions/session-1/scenes/order')
    expect(init.method).toBe('PUT')
    expect(init.signal).toBe(controller.signal)
    expect(JSON.parse(String(init.body))).toEqual({ sceneIds: ['scene-2', 'scene-1'] })
  })

  it('keeps the Scene snapshot call signature compatible while accepting a signal', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, data: { scene: { id: 'scene-1' }, messages: [], runs: [], renders: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await getStudioSceneSnapshot('session 1', 'scene/2')
    await getStudioSceneSnapshot('session 1', 'scene/2', { signal: controller.signal })

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls[0]?.[0]).toBe('/api/studio-agent/sessions/session%201/scenes/scene%2F2')
    expect(calls[0]?.[1].signal).toBeUndefined()
    expect(calls[1]?.[1].signal).toBe(controller.signal)
  })

  it('surfaces a server scene error as a coded request error without leaking a path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ok: false, error: { code: 'WORK_CONFLICT', message: 'A scene source already exists' } }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(createStudioScene('session-1')).rejects.toMatchObject({ code: 'WORK_CONFLICT' })
    await expect(reorderStudioScenes('session-1', ['scene-1'])).rejects.toMatchObject({
      code: 'WORK_CONFLICT',
    })
  })

  it('never throws on a structurally invalid frame', () => {
    const overlong = 's'.repeat(129)
    const malformedFrames: unknown[] = [
      undefined,
      null,
      42,
      'assistant.text',
      [],
      {},
      { type: 'assistant.text' },
      { type: 'assistant.text', properties: null },
      { type: 'assistant.text', properties: [] },
      { type: 'assistant.text', properties: 'scene-1' },
      { type: 'assistant.text', properties: { sceneId: 42 } },
      { type: 'assistant.text', properties: { sceneId: '' } },
      { type: 'assistant.text', properties: { sceneId: '  padded ' } },
      { type: 'assistant.text', properties: { sceneId: `scene-1\u0000` } },
      { type: 'assistant.text', properties: { sceneId: overlong } },
      { type: 'unknown.event', properties: { sceneId: 'scene-1' } },
      { type: 'run.updated', properties: { run: null } },
      { type: 'run.updated', properties: { run: [] } },
      { type: 'run.updated', properties: {} },
      { type: 'render.updated', properties: { render: 'scene-1' } },
      { type: 'tool.result', properties: { sceneId: { value: 'scene-1' } } },
    ]

    for (const frame of malformedFrames) {
      expect(readStudioExternalEventSceneId(frame)).toBeUndefined()
    }
  })
})
