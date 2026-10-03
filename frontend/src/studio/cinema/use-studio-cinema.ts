import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { StudioSession } from '../protocol/studio-agent-types'
import {
  createStudioCinemaController,
  type StudioCinemaController,
  type StudioCinemaControllerDependencies,
} from './cinema-controller'
import type { StudioCinemaState } from './types'

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

  const sessionRef = useRef(input.session)
  sessionRef.current = input.session

  const subscribe = useMemo(() => (listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useMemo(() => () => controller.getState(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const sessionId = input.session?.id ?? null

  useEffect(() => {
    const live = readController()
    if (live !== controller) {
      // A disposed instance was replaced: re-render so the subscription binds to the new store, then
      // this effect runs again with the new instance.
      bumpBindingVersion((version) => version + 1)
      return
    }

    live.attach()
    const session = sessionRef.current
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
    })
    // Recovery read: the index comes from the Session snapshot and never fills a missing Scene in.
    void live.loadSceneIndex()
    // A replay keeps the Session and the selection but lost the subscription with the cleanup.
    live.resumeSelectedScene()

    return () => {
      live.detach()
    }
  }, [controller, sessionId, readController])

  return { state, controller }
}
