import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { StudioSession, StudioSessionSnapshot } from '../protocol/studio-agent-types'
import { getStudioApiBase, getStudioAuthHeaders } from '../api/client'
import { createRenderMediaSession } from '../local/render-media-session'
import { createLocalStudioStore } from '../local/local-studio-store'
import {
  createStudioCinemaController,
  type StudioCinemaController,
  type StudioCinemaControllerDependencies,
} from './cinema-controller'
import type { StudioCinemaState } from './types'
import { buildStudioCinemaSceneKey } from './types'
import { selectStudioCinemaDisplayRender } from './scene-selectors'

function readVisibleCapture(state: StudioCinemaState, sessionId: string | null) {
  if (!sessionId || state.session.id !== sessionId || !state.selectedSceneId) return []
  const scene = state.scenes[buildStudioCinemaSceneKey({ sessionId, sceneId: state.selectedSceneId })]
  if (!scene) return []
  const render = selectStudioCinemaDisplayRender(scene).render
  return [{ identity: scene.identity, renders: render ? [render] : [] }]
}

/**
 * React binding of the Cinema controller.
 *
 * The binding is reentrant, because React can run an effect setup, its cleanup and the setup again
 * without a render in between (StrictMode). Two separate concepts are therefore kept apart:
 *
 * - the effect cleanup calls `detach`, which aborts the stream, drops queued work and invalidates
 *   every in-flight response while keeping the instance reusable, so the replayed setup finds the
 *   same live controller instead of a dead one;
 * - `dispose` stays terminal and is only reached when the instance is really finished (a test, or an
 *   explicit teardown). If a render ever finds a disposed controller, a fresh one is created and the
 *   version bump re-binds the subscription to the new store, so the hook never observes a dead one.
 *
 * The controller itself is created at most once per live instance and construction has no side
 * effect: all network work happens in the effects, never during a render.
 */

export interface UseStudioCinemaInput {
  session: StudioSession | null
  snapshot?: StudioSessionSnapshot | null
  /** Test seam: partial overrides of the real API, Provider, event source and clock. */
  overrides?: Partial<StudioCinemaControllerDependencies>
}

export interface UseStudioCinemaResult {
  state: StudioCinemaState
  controller: StudioCinemaController
}

export function useStudioCinema(input: UseStudioCinemaInput): UseStudioCinemaResult {
  const overridesRef = useRef(input.overrides)
  const controllerRef = useRef<StudioCinemaController | null>(null)
  const [, bumpBindingVersion] = useState(0)

  /**
   * The live controller: the cached instance while it is usable, otherwise a fresh one. Only
   * constructs (no subscription, no request), and it never replaces a live instance, so a double
   * render or a replayed setup cannot produce two live controllers.
   */
  const readController = useCallback((): StudioCinemaController => {
    const current = controllerRef.current
    if (current && !current.isDisposed()) {
      return current
    }
    const next = createStudioCinemaController(overridesRef.current)
    controllerRef.current = next
    return next
  }, [])

  const controller = readController()

  const sessionRef = useRef(input)
  sessionRef.current = input

  const subscribe = useMemo(() => (listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useMemo(() => () => controller.getState(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const sessionId = input.session?.id ?? null
  const mediaSessionRef = useRef<ReturnType<typeof createRenderMediaSession> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // One store and resource owner per Session. StrictMode cleanup can safely release and rebuild it.
  useEffect(() => {
    if (!sessionId || typeof indexedDB === 'undefined') return
    const media = createRenderMediaSession({
      sessionId,
      store: createLocalStudioStore(),
      deps: { fetchImpl: fetch, apiBase: getStudioApiBase(), authHeaders: getStudioAuthHeaders },
      apply: (identity, renderId, url) => controller.applyLocalVideoCapture(identity, renderId, url),
    })
    mediaSessionRef.current = media
    media.sync(readVisibleCapture(stateRef.current, sessionId))
    return () => {
      mediaSessionRef.current = null
      media.dispose()
    }
  }, [sessionId, controller])

  // Only the selected display identity triggers I/O. History updates and typing are unrelated.
  const captureKey = useMemo(() => {
    const visible = readVisibleCapture(state, sessionId)[0]
    return JSON.stringify([sessionId, visible?.identity.sceneId, visible?.renders[0]?.id])
  }, [state, sessionId])

  useEffect(() => {
    // Reads the live state instead of closing over it: the key says when to sync, not what to sync.
    mediaSessionRef.current?.sync(readVisibleCapture(stateRef.current, sessionId))
  }, [captureKey])

  useEffect(() => {
    const live = readController()
    if (live !== controller) {
      // A disposed instance was replaced: re-render so the subscription binds to the new store, then
      // this effect runs again with the new instance.
      bumpBindingVersion((version) => version + 1)
      return
    }

    live.attach()
    const { session, snapshot } = sessionRef.current
    if (!session) {
      live.closeSession()
      return () => {
        live.detach()
      }
    }

    live.openSession({
      sessionId: session.id,
      title: session.title,
      projectId: session.projectId,
      snapshot: snapshot ?? undefined,
    })
    // A cached workspace is shown immediately; refresh its index without holding the selection.
    if (!snapshot && live.getState().sceneOrder.length > 0) void live.loadSceneIndex()
    // The selection binding owns cold index reads; the gateway snapshot is reused on the first open.
    // A replay keeps the Session and the selection but lost the subscription with the cleanup.
    live.resumeSelectedScene()

    return () => {
      live.detach()
    }
  }, [controller, sessionId, readController])

  return { state, controller }
}
