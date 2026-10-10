import type { StudioSceneRender } from '../protocol/studio-agent-types'
import type { LocalStudioStore } from './local-studio-store'
import { captureStudioRenderMedia, type RenderMediaCaptureDeps } from './render-media-capture'

interface CaptureScene {
  identity: { sessionId: string; sceneId: string }
  renders: StudioSceneRender[]
}

/** Owns one Session's capture requests and object URLs. No React or controller dependencies. */
export function createRenderMediaSession(input: {
  sessionId: string
  store: Pick<LocalStudioStore, 'getRender' | 'putRenderVideo' | 'getVideoUrl' | 'close'>
  deps: Omit<RenderMediaCaptureDeps, 'putVideo'>
  apply: (identity: CaptureScene['identity'], renderId: string, url: string | null) => void
  revoke?: (url: string) => void
}) {
  const abort = new AbortController()
  const attempts = new Set<string>()
  const urls = new Map<string, { identity: CaptureScene['identity']; url: string }>()
  const revoke = input.revoke ?? URL.revokeObjectURL.bind(URL)

  async function capture(identity: CaptureScene['identity'], render: StudioSceneRender) {
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
      if (abort.signal.aborted || !attempts.has(render.id)) {
        revoke(url)
        url = null
        return
      }
      urls.set(render.id, { identity, url })
      input.apply(identity, render.id, url)
    } catch {
      if (url) {
        urls.delete(render.id)
        revoke(url)
      }
      // Storage, downloads and URL creation share the same failure boundary: keep public playback.
    }
  }

  return {
    sync(scenes: CaptureScene[]) {
      if (abort.signal.aborted) return
      const eligible = scenes.filter((scene) => scene.identity.sessionId === input.sessionId)
      const live = new Set(eligible.flatMap((scene) => scene.renders.map((render) => render.id)))
      for (const id of attempts) {
        if (!live.has(id)) {
          attempts.delete(id)
          const held = urls.get(id)
          if (held) {
            urls.delete(id)
            input.apply(held.identity, id, null)
            revoke(held.url)
          }
        }
      }
      for (const scene of eligible) {
        for (const render of scene.renders) {
          if (render.status !== 'completed' || render.kind !== 'manim' || render.outputMode !== 'video' || attempts.has(render.id)) continue
          attempts.add(render.id)
          void capture(scene.identity, render)
        }
      }
    },
    dispose() {
      if (abort.signal.aborted) return
      abort.abort()
      for (const [id, held] of urls) {
        input.apply(held.identity, id, null)
        revoke(held.url)
      }
      urls.clear()
      attempts.clear()
      void input.store.close().catch(() => {})
    },
  }
}
