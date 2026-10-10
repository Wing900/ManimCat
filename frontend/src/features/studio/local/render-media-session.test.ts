import { describe, expect, it, vi } from 'vitest'
import { createRenderMediaSession } from './render-media-session'
import { createTestRender, CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A } from '../cinema/cinema-fixtures'
import type { LocalRender } from './local-studio-store'

const identity = { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A }
const render = createTestRender(identity.sceneId, 'render_1', { outputMode: 'video' })
const scene = { identity, renders: [render] }

function harness(stored: LocalRender | null = null) {
  const store = {
    getRender: vi.fn(async () => stored),
    putRenderVideo: vi.fn(async (_render: LocalRender, _blob: Blob, _mime?: string) => 'video_1'),
    getVideoUrl: vi.fn(async () => 'blob:local-video'),
    close: vi.fn(async () => {}),
  }
  const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'video/mp4' } }))
  const apply = vi.fn()
  const revoke = vi.fn()
  const create = () => createRenderMediaSession({ sessionId: identity.sessionId, store, apply, revoke,
    deps: { fetchImpl, authHeaders: () => ({}), apiBase: '/api' } })
  return { store, fetchImpl, apply, revoke, create }
}

describe('render media Session ownership', () => {
  it('restores a persisted video without downloading it again', async () => {
    const h = harness({ ...render, videoRef: 'persisted-video' })
    const session = h.create()
    session.sync([scene])
    await vi.waitFor(() => expect(h.apply).toHaveBeenCalledWith(identity, render.id, 'blob:local-video'))
    expect(h.fetchImpl).not.toHaveBeenCalled()
    expect(h.store.putRenderVideo).not.toHaveBeenCalled()
    session.dispose()
  })

  it('downloads once and persists the Render together with its video', async () => {
    const h = harness()
    const session = h.create()
    session.sync([scene])
    session.sync([scene])
    await vi.waitFor(() => expect(h.apply).toHaveBeenCalledWith(identity, render.id, 'blob:local-video'))
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    expect(h.store.putRenderVideo.mock.calls[0]?.[0]).toEqual(render)
    session.dispose()
    expect(h.revoke).toHaveBeenCalledWith('blob:local-video')
    expect(h.apply).toHaveBeenLastCalledWith(identity, render.id, null)
    expect(h.store.close).toHaveBeenCalledOnce()
  })

  it('catches storage read failures and leaves server playback unchanged', async () => {
    const h = harness({ ...render, videoRef: 'video' })
    h.store.getVideoUrl.mockRejectedValue(new Error('storage unavailable'))
    const session = h.create()
    session.sync([scene])
    await vi.waitFor(() => expect(h.store.getVideoUrl).toHaveBeenCalled())
    expect(h.apply).not.toHaveBeenCalled()
    session.dispose()
  })

  it('reads the saved Render link when a new page lifecycle starts', async () => {
    const h = harness()
    const first = h.create()
    first.sync([scene])
    await vi.waitFor(() => expect(h.apply).toHaveBeenCalledWith(identity, render.id, 'blob:local-video'))
    first.dispose()
    h.store.getRender.mockResolvedValue({ ...render, videoRef: 'video_1' })
    const second = h.create()
    second.sync([scene])
    await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(3))
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    second.dispose()
  })

  it('revokes a playback URL whose storage read finishes after disposal', async () => {
    const h = harness({ ...render, videoRef: 'saved' })
    let release!: (url: string) => void
    h.store.getVideoUrl.mockImplementation(() => new Promise<string>((resolve) => { release = resolve }))
    const session = h.create()
    session.sync([scene])
    await vi.waitFor(() => expect(h.store.getVideoUrl).toHaveBeenCalledOnce())
    session.dispose()
    release('blob:late')
    await vi.waitFor(() => expect(h.revoke).toHaveBeenCalledWith('blob:late'))
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('aborts downloads on disposal and never applies late results', async () => {
    const h = harness()
    let release!: (response: Response) => void
    h.fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => { release = resolve }))
    const session = h.create()
    session.sync([scene])
    await vi.waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce())
    session.dispose()
    release(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'video/mp4' } }))
    await vi.waitFor(() => expect(h.store.close).toHaveBeenCalledOnce())
    expect(h.store.putRenderVideo).not.toHaveBeenCalled()
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('ignores image renders and other Sessions', async () => {
    const h = harness()
    const session = h.create()
    session.sync([{ identity, renders: [{ ...render, outputMode: 'image' }] },
      { identity: { ...identity, sessionId: 'other' }, renders: [render] }])
    expect(h.store.getRender).not.toHaveBeenCalled()
    session.dispose()
  })
})
