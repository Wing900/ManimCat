/**
 * Pulls a finished Render's video out of the server and into local storage.
 *
 * Server deletion stays disabled until durable delivery acknowledgement is implemented. Nothing
 * here throws: failed capture leaves playback on the server copy.
 */

/** Path segments this capture is willing to name. Anything else never reaches a URL. */
const CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export interface RenderMediaCaptureDeps {
  /** Injected so a spec can drive a capture without a network or a browser. */
  fetchImpl: typeof fetch
  /** Injected so a spec can observe what was stored without an IndexedDB. */
  putVideo: (blob: Blob, mime?: string) => Promise<string>
  apiBase: string
  authHeaders: () => HeadersInit
}

export interface RenderMediaCaptureInput {
  sessionId: string
  sceneId: string
  renderId: string
  deps: RenderMediaCaptureDeps
  signal?: AbortSignal
}

export function studioRenderMediaUrl(input: {
  apiBase: string
  sessionId: string
  sceneId: string
  renderId: string
}): string | null {
  const segments = [input.sessionId, input.sceneId, input.renderId]
  if (!segments.every((segment) => CAPTURE_ID_PATTERN.test(segment))) {
    return null
  }

  const base = input.apiBase.endsWith('/') ? input.apiBase.slice(0, -1) : input.apiBase
  return `${base}/studio-agent/sessions/${segments[0]}/scenes/${segments[1]}/renders/${segments[2]}/video`
}

/**
 * Returns the local `videoRef` for the captured video, or `null` when there is nothing worth
 * keeping. An empty body is treated as nothing: a zero-byte file is not a video, and storing it
 * would turn a server-side failure into a player that hangs on a broken source.
 */
export async function captureStudioRenderMedia(input: RenderMediaCaptureInput): Promise<string | null> {
  const url = studioRenderMediaUrl({
    apiBase: input.deps.apiBase,
    sessionId: input.sessionId,
    sceneId: input.sceneId,
    renderId: input.renderId
  })
  if (!url) {
    return null
  }

  try {
    const response = await input.deps.fetchImpl(url, {
      method: 'GET',
      signal: input.signal,
      headers: input.deps.authHeaders()
    })
    if (!response.ok) {
      return null
    }

    const blob = await response.blob()
    if (blob.size === 0 || input.signal?.aborted) {
      return null
    }

    const mime = response.headers.get('content-type') ?? undefined
    if (!mime?.toLowerCase().split(';')[0].trim().startsWith('video/')) return null
    return await input.deps.putVideo(blob, mime ?? undefined)
  } catch {
    return null
  }
}
