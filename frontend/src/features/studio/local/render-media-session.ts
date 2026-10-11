import type { StudioSceneRender } from '../protocol/studio-agent-types'
import type { LocalStudioStore } from './local-studio-store'
import { captureStudioRenderMedia, type RenderMediaCaptureDeps } from './render-media-capture'

interface CaptureScene {
  identity: { sessionId: string; sceneId: string }
  renders: StudioSceneRender[]
}

/** Visible-media resource owner. One capture at a time, two retained URLs for smooth switches. */
export function createRenderMediaSession(input: {
  sessionId: string
  store: Pick<LocalStudioStore, 'getRender' | 'putRenderVideo' | 'getVideoUrl' | 'close'>
  deps: Omit<RenderMediaCaptureDeps, 'putVideo'>
  apply: (identity: CaptureScene['identity'], renderId: string, url: string | null) => void
  revoke?: (url: string) => void
}) {
  let disposed = false
  let selectedId: string | null = null
  const requests = new Map<string, AbortController>()
  const urls = new Map<string, { identity: CaptureScene['identity']; url: string }>()
  const revoke = input.revoke ?? URL.revokeObjectURL.bind(URL)

  async function capture(identity: CaptureScene['identity'], render: StudioSceneRender, abort: AbortController) {
    let url: string | null = null
    try {
      const stored = await input.store.getRender(identity.sessionId, render.id)
      if (abort.signal.aborted) return
      if (stored?.videoRef) url = await input.store.getVideoUrl(stored.videoRef)
      if (!url && !abort.signal.aborted) {
        const videoRef = await captureStudioRenderMedia({
          ...identity, renderId: render.id, signal: abort.signal,
          deps: { ...input.deps, putVideo: (blob, mime) => input.store.putRenderVideo(render, blob, mime) },
        })
        if (videoRef && !abort.signal.aborted) url = await input.store.getVideoUrl(videoRef)
      }
      if (!url) return
      if (disposed || abort.signal.aborted || selectedId !== render.id) {
        revoke(url)
        url = null
        return
      }
      urls.set(render.id, { identity, url })
      input.apply(identity, render.id, url)
      // Keep the previous frame's URL while its exit animation finishes. Older versions
      // remain durable in IndexedDB; their object URLs consume no resident media resources.
      while (urls.size > 2) {
        const oldest = urls.keys().next().value!
        const held = urls.get(oldest)!
        urls.delete(oldest)
        input.apply(held.identity, oldest, null)
        revoke(held.url)
      }
    } catch {
      if (url) {
        urls.delete(render.id)
        revoke(url)
      }
      // Storage, downloads and URL creation share the same failure boundary: keep public playback.
    } finally {
      if (requests.get(render.id) === abort) requests.delete(render.id)
    }
  }

  return {
    sync(scenes: CaptureScene[]) {
      if (disposed) return
      // Caller passes only the displayed render of the selected scene, never the session archive.
      const scene = scenes.find(scene => scene.identity.sessionId === input.sessionId)
      const render = scene?.renders.find(render => render.status === 'completed' && render.kind === 'manim' && render.outputMode === 'video')
      const nextId = render?.id ?? null
      if (nextId === selectedId) return
      selectedId = nextId
      for (const request of requests.values()) request.abort()
      requests.clear()
      if (!render || !scene) return
      const held = urls.get(render.id)
      if (held) {
        urls.delete(render.id)
        urls.set(render.id, held)
        input.apply(scene.identity, render.id, held.url)
        return
      }
      const abort = new AbortController()
      requests.set(render.id, abort)
      void capture(scene.identity, render, abort)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const request of requests.values()) request.abort()
      requests.clear()
      for (const [id, held] of urls) {
        input.apply(held.identity, id, null)
        revoke(held.url)
      }
      urls.clear()
      void input.store.close().catch(() => {})
    },
  }
}
