import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioKind, StudioSession, StudioSessionSnapshot } from '../../protocol/studio-agent-types'
import { studioServerPort } from '../../api/studio-server-port'
import { localFirstStudioPorts } from '../../local/local-first-ports'
import { isStudioClientDataMode } from '../../../../infrastructure/api/runtime-config'
import {
  forgetStudioSessionId,
  readLastStudioSessionId,
  readRecentStudioSessionIds,
  rememberStudioSessionId,
  writeLastStudioSessionId,
} from '../../session-history/session-storage'
import {
  StudioCinemaSessionGateway,
  type StudioCinemaSessionGatewayApi,
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
export type StudioCinemaSessionLoadingOperation = 'restore' | 'create' | 'select'

/**
 * The order the sidebar reads downwards: oldest first, the newest Session at the bottom, where the
 * list already scrolls to. The stored list is in recency order (newest first), so this one flip turns
 * it into the reading order — and everything downstream (the row names, which follow the position, and
 * the push direction, which follows the list order) then agrees with what is on screen.
 */
function readDisplayHistoryIds(storage: StudioCinemaSessionGatewayStorage, studioKind: string): string[] {
  return [...storage.readRecentSessionIds(studioKind)].reverse()
}

export type StudioCinemaSessionFailure =
  | 'restore_unavailable'
  | 'restore_missing'
  | 'create_failed'
  | 'create_unknown'
  | 'unexpected'

export interface UseStudioCinemaSessionResult {
  status: StudioCinemaSessionStatus
  loadingOperation: StudioCinemaSessionLoadingOperation | null
  session: StudioSession | null
  snapshot: StudioSessionSnapshot | null
  /** How this Session got here: only a `created` one triggers Scene initialization. */
  origin: 'created' | 'restored' | null
  historyIds: string[]
  failure: StudioCinemaSessionFailure | null
  createNewSession: () => void
  retry: () => void
  selectSession: (sessionId: string) => void
  /**
   * Deletes one Session (server first, then the local entry) and moves the workspace on if it was the
   * one on screen. `false` means nothing was removed: the request failed, or the write was refused by a
   * detached binding.
   */
  forgetSession: (sessionId: string) => Promise<boolean>
}

export interface UseStudioCinemaSessionInput {
  studioKind: StudioKind
  /** Test seam: partial overrides of the real API and storage. */
  overrides?: Partial<StudioCinemaSessionGatewayDependencies>
}

interface StudioCinemaSessionBindingState {
  status: StudioCinemaSessionStatus
  loadingOperation: StudioCinemaSessionLoadingOperation | null
  session: StudioSession | null
  snapshot: StudioSessionSnapshot | null
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

/**
 * The Session port, resolved per call for the same reason as the Scene port: the shape is decided by
 * `GET /api/runtime-config` while the app is booting, and in the client shape
 * (`STUDIO_DATA_MODE=client`) the session identity belongs to this browser.
 */
function createDefaultSessionApi(): StudioCinemaSessionGatewayApi {
  const resolve = (): StudioCinemaSessionGatewayApi =>
    isStudioClientDataMode() ? localFirstStudioPorts().sessionApi : studioServerPort

  return {
    createSession: (input) => resolve().createSession(input),
    getSessionSnapshot: (sessionId, options) => resolve().getSessionSnapshot(sessionId, options),
    deleteSession: (sessionId) => resolve().deleteSession(sessionId),
  }
}

function createDefaultDependencies(
  title: string
): Omit<StudioCinemaSessionGatewayDependencies, 'storage' | 'isOwned'> {
  return {
    api: createDefaultSessionApi(),
    createAbortController: () => new AbortController(),
    projectId: STUDIO_CINEMA_SESSION_PROJECT_ID,
    defaultTitle: title,
  }
}

export function useStudioCinemaSession(input: UseStudioCinemaSessionInput): UseStudioCinemaSessionResult {
  const { studioKind } = input
  const overridesRef = useRef(input.overrides)
  const title = studioKind === 'matplotlib' ? 'Plot Studio' : 'Manim Studio'

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
    loadingOperation: 'restore',
    session: null,
    snapshot: null,
    origin: null,
    historyIds: readDisplayHistoryIds(storage, studioKind),
    failure: null,
  }))

  /** Monotonic intent id: only the newest workflow may write to this binding. */
  const generationRef = useRef(0)

  const readHistory = useCallback(
    () => readDisplayHistoryIds(storage, studioKind),
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
          loadingOperation: null,
          session: outcome.session,
          snapshot: outcome.snapshot ?? null,
          origin: outcome.origin,
          historyIds: readHistory(),
          failure: null,
        })
        return
      }
      // The Session could not be decided: the history stays intact and the user gets a safe action.
      setState({
        status: 'unavailable',
        loadingOperation: null,
        session: null,
        snapshot: null,
        origin: null,
        historyIds: readHistory(),
        failure: outcome.reason,
      })
    },
    [isBindingOwned, readHistory]
  )

  const run = useCallback(
    (mode: StudioCinemaSessionLoadingOperation, sessionId?: string) => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      setState((previous) => ({ ...previous, status: 'loading', loadingOperation: mode, failure: null }))

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
            loadingOperation: null,
            session: null,
            snapshot: null,
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
    loadingOperation: state.loadingOperation,
    session: state.session,
    snapshot: state.snapshot,
    origin: state.origin,
    historyIds: state.historyIds,
    failure: state.failure,
    createNewSession: useCallback(() => run('create'), [run]),
    retry: useCallback(() => run('restore'), [run]),
    selectSession: useCallback((sessionId: string) => run('select', sessionId), [run]),
    /**
     * Removes one history entry the user asked to delete.
     *
     * The write itself is the gateway's, so it carries the same ownership gate as every other write —
     * and the answer is passed back, so a caller that was refused does not clear what belongs to the
     * entry (its Scene choice). A Session that was on screen is not left as a hole: the next candidate
     * is opened, and a history that ran out creates a new Session, exactly as an attach would.
     */
    forgetSession: useCallback(
      async (sessionId: string) => {
        const forgotten = await gateway.delete(studioKind, sessionId)
        if (!forgotten) {
          return false
        }
        if (state.session?.id === sessionId) {
          run('restore')
        } else {
          setState((previous) => ({ ...previous, historyIds: readHistory() }))
        }
        return true
      },
      [gateway, readHistory, run, state.session?.id, studioKind],
    ),
  }
}
