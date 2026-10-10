import { describe, expect, it, vi } from 'vitest'
import {
  captureStudioRenderMedia,
  studioRenderMediaUrl,
  type RenderMediaCaptureDeps
} from './render-media-capture'

function deps(overrides: Partial<RenderMediaCaptureDeps> = {}): RenderMediaCaptureDeps {
  return {
    fetchImpl: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } })),
    putVideo: vi.fn(async (_blob: Blob, _mime?: string) => 'vid_stored'),
    apiBase: '/api',
    authHeaders: () => ({ Authorization: 'Bearer k' }),
    ...overrides
  }
}

describe('studioRenderMediaUrl', () => {
  it('addresses a render video and tolerates a trailing slash on the base', () => {
    expect(
      studioRenderMediaUrl({ apiBase: '/api/', sessionId: 'sess_1', sceneId: 'scene_1', renderId: 'run-1' })
    ).toBe('/api/studio-agent/sessions/sess_1/scenes/scene_1/renders/run-1/video')
  })

  it('refuses a segment that is not a plain id', () => {
    expect(
      studioRenderMediaUrl({ apiBase: '/api', sessionId: 'sess_1', sceneId: '../etc', renderId: 'run-1' })
    ).toBeNull()
  })
})

describe('captureStudioRenderMedia', () => {
  it('refuses a non-video response without storing an error page', async () => {
    const dependency = deps({ fetchImpl: vi.fn(async () => new Response('<html>error</html>', {
      headers: { 'Content-Type': 'text/html' },
    })) })
    expect(await captureStudioRenderMedia({ sessionId: 'sess_1', sceneId: 'scene_1', renderId: 'render_1', deps: dependency })).toBeNull()
    expect(dependency.putVideo).not.toHaveBeenCalled()
  })

  it('never stores a response after cancellation', async () => {
    const controller = new AbortController()
    const dependency = deps({ fetchImpl: vi.fn(async () => {
      controller.abort()
      return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'video/mp4' } })
    }) })
    expect(await captureStudioRenderMedia({ sessionId: 'sess_1', sceneId: 'scene_1', renderId: 'render_1',
      deps: dependency, signal: controller.signal })).toBeNull()
    expect(dependency.putVideo).not.toHaveBeenCalled()
  })
  it('stores a fetched video and returns its local ref', async () => {
    const putVideo = vi.fn(async (_blob: Blob, _mime?: string) => 'vid_stored')
    const ref = await captureStudioRenderMedia({
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: 'run-1',
      deps: deps({ putVideo })
    })

    expect(ref).toBe('vid_stored')
    expect(putVideo).toHaveBeenCalledTimes(1)
    const [blob, mime] = putVideo.mock.calls[0]
    expect(blob.size).toBe(3)
    expect(mime).toBe('video/mp4')
  })

  it('returns null instead of throwing when the request fails', async () => {
    const ref = await captureStudioRenderMedia({
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: 'run-1',
      deps: deps({
        fetchImpl: vi.fn(async () => {
          throw new Error('offline')
        })
      })
    })

    expect(ref).toBeNull()
  })

  it('returns null for a non-2xx answer and stores nothing', async () => {
    const putVideo = vi.fn(async (_blob: Blob, _mime?: string) => 'vid_stored')
    const ref = await captureStudioRenderMedia({
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: 'run-1',
      deps: deps({ fetchImpl: vi.fn(async () => new Response('gone', { status: 404 })), putVideo })
    })

    expect(ref).toBeNull()
    expect(putVideo).not.toHaveBeenCalled()
  })

  it('treats an empty body as nothing to keep', async () => {
    const putVideo = vi.fn(async (_blob: Blob, _mime?: string) => 'vid_stored')
    const ref = await captureStudioRenderMedia({
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: 'run-1',
      deps: deps({ fetchImpl: vi.fn(async () => new Response(new Uint8Array(0))), putVideo })
    })

    expect(ref).toBeNull()
    expect(putVideo).not.toHaveBeenCalled()
  })

  it('never sends a request for a malformed id', async () => {
    const fetchImpl = vi.fn()
    const ref = await captureStudioRenderMedia({
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: '../x',
      deps: deps({ fetchImpl: fetchImpl as unknown as typeof fetch })
    })

    expect(ref).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
