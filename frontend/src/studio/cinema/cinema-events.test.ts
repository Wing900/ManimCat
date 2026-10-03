import { describe, expect, it } from 'vitest'
import { decodeStudioCinemaSceneEvent, readStudioCinemaSceneRun } from './scene-events'
import {
  CINEMA_TEST_SCENE_A,
  CINEMA_TEST_SESSION_ID,
  createTestFrame,
  createTestScopedProperties,
} from './cinema-fixtures'

/**
 * Scene event decoder specs (task 11C1, section 6). Every case drives the real decoder with a raw
 * `JSON.parse`-shaped value; nothing here opens a socket, so the guard is verified without a server.
 */
describe('studio cinema scene event decoder', () => {
  it('narrows a run.updated frame into a Scene run without internal fields', () => {
    const decoded = decodeStudioCinemaSceneEvent(
      createTestFrame('run.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        run: {
          id: 'run_1',
          sessionId: CINEMA_TEST_SESSION_ID,
          sceneId: CINEMA_TEST_SCENE_A,
          status: 'running',
          inputText: 'draw',
          activeAgent: 'builder',
          createdAt: '2026-03-22T00:00:00.000Z',
          // Fields of the wider Legacy record: they must not survive the narrowing.
          ownerId: 'owner_1',
          error: 'internal failure text',
          metadata: { sourcePath: 'D:/private/source.py' },
        },
      }),
    )

    expect(decoded?.identity).toEqual({ sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A })
    expect(decoded?.event.kind).toBe('run-updated')
    const run = decoded?.event.kind === 'run-updated' ? decoded.event.run : null
    expect(run).not.toBeNull()
    expect(run && 'error' in run).toBe(false)
    expect(run && 'metadata' in run).toBe(false)
    expect(run && 'ownerId' in run).toBe(false)
    expect(run?.status).toBe('running')
  })

  it('narrows a render.updated frame and keeps only public media', () => {
    const decoded = decodeStudioCinemaSceneEvent(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: {
          id: 'render_1',
          sessionId: CINEMA_TEST_SESSION_ID,
          sceneId: CINEMA_TEST_SCENE_A,
          kind: 'manim',
          title: 'circle',
          status: 'completed',
          concept: 'a circle',
          outputMode: 'video',
          sourcePath: 'D:/private/source.py',
          error: 'internal failure text',
          ownerId: 'owner_1',
          attachments: [
            { kind: 'file', path: 'scenes/out.mp4', mimeType: 'video/mp4', extra: 'dropped' },
            { kind: 'url', path: 'https://example.invalid/x.mp4' },
          ],
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T00:00:00.000Z',
        },
      }),
    )

    const render = decoded?.event.kind === 'render-updated' ? decoded.event.render : null
    expect(render).not.toBeNull()
    expect(render && 'sourcePath' in render).toBe(false)
    expect(render && 'error' in render).toBe(false)
    expect(render && 'ownerId' in render).toBe(false)
    expect(render?.attachments).toEqual([
      { kind: 'file', path: 'scenes/out.mp4', mimeType: 'video/mp4' },
    ])
  })

  it('drops the model Tool arguments and the internal error text from streaming frames', () => {
    const inputStart = decodeStudioCinemaSceneEvent(
      createTestFrame('tool.input-start', {
        ...createTestScopedProperties(CINEMA_TEST_SCENE_A),
        toolName: 'write',
        callId: 'call_1',
        raw: '{"path":"D:/private/source.py"}',
      }),
    )
    expect(inputStart?.event).toEqual({
      kind: 'tool-input-start',
      runId: 'run_1',
      messageId: 'message_1',
      toolName: 'write',
      callId: 'call_1',
    })

    const toolCall = decodeStudioCinemaSceneEvent(
      createTestFrame('tool.call', {
        ...createTestScopedProperties(CINEMA_TEST_SCENE_A),
        toolName: 'write',
        callId: 'call_1',
        input: { path: 'D:/private/source.py' },
      }),
    )
    expect(toolCall?.event).toEqual({
      kind: 'tool-call',
      runId: 'run_1',
      messageId: 'message_1',
      toolName: 'write',
      callId: 'call_1',
    })

    const result = decodeStudioCinemaSceneEvent(
      createTestFrame('tool.result', {
        ...createTestScopedProperties(CINEMA_TEST_SCENE_A),
        toolName: 'static-check',
        callId: 'call_1',
        status: 'failed',
        error: 'ENOENT: D:/private/source.py',
        metadata: { diagnosticCount: 2 },
      }),
    )
    const properties = JSON.stringify(result)
    expect(properties.includes('ENOENT')).toBe(false)
    expect(properties.includes('D:/private')).toBe(false)
    expect(result?.event.kind === 'tool-result' ? result.event.metadata : null).toEqual({
      diagnosticCount: 2,
    })
  })

  it('keeps assistant text exactly as sent, including repeated content', () => {
    const first = decodeStudioCinemaSceneEvent(
      createTestFrame('assistant.text', {
        ...createTestScopedProperties(CINEMA_TEST_SCENE_A),
        text: 'hello',
      }),
    )
    const second = decodeStudioCinemaSceneEvent(
      createTestFrame('assistant.text', {
        ...createTestScopedProperties(CINEMA_TEST_SCENE_A),
        text: 'hello',
      }),
    )

    expect(first?.event.kind === 'assistant-text' ? first.event.text : null).toBe('hello')
    expect(second?.event.kind === 'assistant-text' ? second.event.text : null).toBe('hello')
  })

  it('answers null for an unknown type, a malformed frame or a missing scope', () => {
    expect(decodeStudioCinemaSceneEvent(null)).toBeNull()
    expect(decodeStudioCinemaSceneEvent('assistant.text')).toBeNull()
    expect(decodeStudioCinemaSceneEvent([])).toBeNull()
    expect(decodeStudioCinemaSceneEvent({ type: 'assistant.text' })).toBeNull()
    expect(decodeStudioCinemaSceneEvent(createTestFrame('unknown.type', { sessionId: 's', sceneId: 'x' }))).toBeNull()
    // A Legacy Session frame: no sceneId, so it can never become a Scene event.
    expect(
      decodeStudioCinemaSceneEvent(
        createTestFrame('assistant.text', {
          ...createTestScopedProperties(undefined),
          text: 'legacy',
        }),
      ),
    ).toBeNull()
    // A malformed identifier is as good as absent.
    expect(
      decodeStudioCinemaSceneEvent(
        createTestFrame('assistant.text', {
          ...createTestScopedProperties('scene with space'),
          text: 'x',
        }),
      ),
    ).toBeNull()
    expect(
      decodeStudioCinemaSceneEvent(
        createTestFrame('assistant.text', {
          ...createTestScopedProperties(CINEMA_TEST_SCENE_A),
          text: 42,
        }),
      ),
    ).toBeNull()
  })

  it('reports a scene.updated frame whose nested run carries no scene as unscoped', () => {
    const decoded = decodeStudioCinemaSceneEvent(
      createTestFrame('run.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        run: { id: 'run_1', sessionId: CINEMA_TEST_SESSION_ID, status: 'running' },
      }),
    )
    expect(decoded).toBeNull()
  })

  it('treats connected and heartbeat frames as connection state without a Scene', () => {
    const connected = decodeStudioCinemaSceneEvent(
      createTestFrame('studio.connected', { timestamp: 1700 }),
    )
    const heartbeat = decodeStudioCinemaSceneEvent(
      createTestFrame('studio.heartbeat', { timestamp: 1701 }),
    )

    expect(connected?.identity).toBeNull()
    expect(connected?.event).toEqual({ kind: 'connection', state: 'connected', timestamp: 1700 })
    expect(heartbeat?.event).toEqual({ kind: 'connection', state: 'heartbeat', timestamp: 1701 })
    expect(
      decodeStudioCinemaSceneEvent(createTestFrame('studio.connected', { timestamp: 'x' }))?.event,
    ).toEqual({ kind: 'connection', state: 'connected', timestamp: 0 })
  })

  it('narrows a cancel response run with the same rule, refusing a malformed record', () => {
    const narrowed = readStudioCinemaSceneRun({
      id: 'run_1',
      sessionId: CINEMA_TEST_SESSION_ID,
      sceneId: CINEMA_TEST_SCENE_A,
      status: 'cancelled',
      inputText: 'draw',
      activeAgent: 'builder',
      createdAt: '2026-03-22T00:00:00.000Z',
      error: 'internal failure text',
    })

    expect(narrowed?.status).toBe('cancelled')
    expect(narrowed && 'error' in narrowed).toBe(false)
    expect(readStudioCinemaSceneRun({ id: 'run_1', status: 'cancelled' })).toBeNull()
    expect(readStudioCinemaSceneRun(null)).toBeNull()
  })
})
