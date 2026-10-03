import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createStudioSession,
  getStudioSessionSnapshot,
} from '../../api/studio-agent-api'
import type { StudioKind, StudioSession } from '../../protocol/studio-agent-types'
import {
  forgetStudioSessionId,
  readLastStudioSessionId,
  readRecentStudioSessionIds,
  rememberStudioSessionId,
  writeLastStudioSessionId,
} from '../../session-history/session-storage'
import {
  StudioCinemaSessionGateway,
  type StudioCinemaSessionGatewayDependencies,
  type StudioCinemaSessionGatewayStorage,
  type StudioCinemaSessionOutcome,
} from './studio-cinema-session-gateway'

/**
 * React binding of the Session gateway (task 11C2).
 *
 * It answers one question — *which* Session does this workspace talk to — and nothing else: it never
 * subscribes to a Session stream and never submits a Legacy Run. The Scene controller owns the rest.
 *
 * StrictMode safety comes from the gateway, not from this hook: the effect cleanup deliberately does
 * not invalidate the running workflow, so a replayed setup joins the create/restore that is already
 * in flight instead of starting a second one. A response that belongs to a superseded intent is
 * dropped by the generation guard, so a late restore can never replace the Session the user chose.
 */

export type StudioCinemaSessionStatus = 'loading' | 'ready' | 'unavailable'

export type StudioCinemaSessionFailure =
  | 'restore_unavailable'
  | 'restore_missing'
  | 'create_failed'
  | 'create_unknown'
  | 'unexpected'

export interface UseStudioCinemaSessionResult {
  status: StudioCinemaSessionStatus
  session: StudioSession | null
  /** How this Session got here: only a `created` one triggers Scene initialization. */
  origin: 'created' | 'restored' | null
  historyIds: string[]
  failure: StudioCinemaSessionFailure | null
  createNewSession: () => void
  retry: () => void
  selectSession: (sessionId: string) => void
}

export interface UseStudioCinemaSessionInput {
  studioKind: StudioKind
  /** Test seam: partial overrides of the real API and storage. */
  overrides?: Partial<StudioCinemaSessionGatewayDependencies>
}

interface StudioCinemaSessionBindingState {
  status: StudioCinemaSessionStatus
  session: StudioSession | null
  origin: 'created' | 'restored' | null
  historyIds: string[]
  failure: StudioCinemaSessionFailure | null
}

export const STUDIO_CINEMA_SESSION_PROJECT_ID = 'manimcat-studio'

/** The named storage dependency of this hook: the real one unless a test injects another. */
export function createDefaultStudioCinemaSessionStorage(): StudioCinemaSessionGatewayStorage {
  return {
    readLastSessionId: (studioKind) => readLastStudioSessionId(studioKind),
    readRecentSessionIds: (studioKind) => readRecentStudioSessionIds(studioKind),
    rememberSessionId: (studioKind, sessionId) => rememberStudioSessionId(studioKind, sessionId),
    markLastSessionId: (studioKind, sessionId) => writeLastStudioSessionId(studioKind, sessionId),
    forgetSessionId: (studioKind, sessionId) => forgetStudioSessionId(studioKind, sessionId),
  }
}

function createDefaultDependencies(
  title: string
): Omit<StudioCinemaSessionGatewayDependencies, 'storage' | 'isOwned'> {
  return {
    api: {
      createSession: (input) => createStudioSession(input),
      getSessionSnapshot: (sessionId, options) => getStudioSessionSnapshot(sessionId, options),
    },
    createAbortController: () => new AbortController(),
    projectId: STUDIO_CINEMA_SESSION_PROJECT_ID,
    defaultTitle: title,
  }
}

export function useStudioCinemaSession(input: UseStudioCinemaSessionInput): UseStudioCinemaSessionResult {
  const { studioKind } = input
  const overridesRef = useRef(input.overrides)
  const title = studioKind === 'plot' ? 'Plot Studio' : 'Manim Studio'

  // Every history read and write goes through this port, so an injected store is the *only* storage
  // the hook touches (correction R5) and a spec can assert that no global storage is used.
  const storage = useMemo(
    () => overridesRef.current?.storage ?? createDefaultStudioCinemaSessionStorage(),
    []
  )

  /**
   * Ownership of the responses (correction R5). This object survives an effect *replay* — React keeps
   * the instance and its refs — but not a real unmount, where nothing re-attaches it. A late
   * restore/create is therefore applied only by a live binding, and the gateway never writes history
   * for a screen that is gone.
   */
  const bindingRef = useRef<{ attached: boolean }>({ attached: false })

  /**
   * The one ownership predicate (correction F2). The gateway and every state write of this hook consult
   * this same function, so the two gates cannot drift apart: an unowned intent issues no request, an
   * unowned response (success *or* failure) writes neither state nor history.
   */
  const isBindingOwned = useCallback(() => bindingRef.current.attached, [])

  const gateway = useMemo(
    () =>
      new StudioCinemaSessionGateway({
        ...createDefaultDependencies(title),
        ...overridesRef.current,
        storage,
        isOwned: isBindingOwned,
      }),
    [isBindingOwned, storage, title]
  )

  const [state, setState] = useState<StudioCinemaSessionBindingState>(() => ({
    status: 'loading',
    session: null,
    origin: null,
    historyIds: storage.readRecentSessionIds(studioKind),
    failure: null,
  }))

  /** Monotonic intent id: only the newest workflow may write to this binding. */
  const generationRef = useRef(0)

  const readHistory = useCallback(
    () => storage.readRecentSessionIds(studioKind),
    [storage, studioKind]
  )

  const apply = useCallback(
    (generation: number, outcome: StudioCinemaSessionOutcome) => {
      if (!isBindingOwned()) {
        // A detached binding (a real unmount) must not write state: only the binding that is attached
        // right now may consume a result, so a replay mid-flight is joined instead of duplicated.
        return
      }
      if (generationRef.current !== generation) {
        return
      }
      if (outcome.status === 'stale') {
        return
      }
      if (outcome.status === 'ready') {
        setState({
          status: 'ready',
          session: outcome.session,
          origin: outcome.origin,
          historyIds: readHistory(),
          failure: null,
        })
        return
      }
      // The Session could not be decided: the history stays intact and the user gets a safe action.
      setState({
        status: 'unavailable',
        session: null,
        origin: null,
        historyIds: readHistory(),
        failure: outcome.reason,
      })
    },
    [isBindingOwned, readHistory]
  )

  const run = useCallback(
    (mode: 'restore' | 'create' | 'select', sessionId?: string) => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      setState((previous) => ({ ...previous, status: 'loading', failure: null }))

      const workflow =
        mode === 'create'
          ? gateway.createNew(studioKind)
          : mode === 'select' && sessionId
            ? gateway.restore(studioKind, sessionId)
            : gateway.open(studioKind)

      void workflow
        .then((outcome) => apply(generation, outcome))
        .catch(() => {
          // The gateway already converts failures into outcomes; this is the "must not happen" net, so
          // the workspace never sees an unhandled rejection. It carries the *same* ownership and intent
          // gate as the success path: a detached binding writes neither state nor storage here either
          // (correction F2), so a rejected dependency cannot resurrect a screen that is gone.
          if (!isBindingOwned() || generationRef.current !== generation) {
            return
          }
          setState({
            status: 'unavailable',
            session: null,
            origin: null,
            historyIds: readHistory(),
            failure: 'unexpected',
          })
        })
    },
    [apply, gateway, isBindingOwned, readHistory, studioKind]
  )

  useEffect(() => {
    // Re-entrant attach (correction R5): the binding object is kept, so a StrictMode
    // setup -> cleanup -> setup re-attaches the *same* binding and joins the workflow that is already
    // running. Cleanup only detaches; it never invalidates, which would abort an in-flight create and
    // risk starting a second Session on the replay.
    bindingRef.current.attached = true
    run('restore')
    return () => {
      bindingRef.current.attached = false
    }
  }, [run])

  return {
    status: state.status,
    session: state.session,
    origin: state.origin,
    historyIds: state.historyIds,
    failure: state.failure,
    createNewSession: useCallback(() => run('create'), [run]),
    retry: useCallback(() => run('restore'), [run]),
    selectSession: useCallback((sessionId: string) => run('select', sessionId), [run]),
  }
}
