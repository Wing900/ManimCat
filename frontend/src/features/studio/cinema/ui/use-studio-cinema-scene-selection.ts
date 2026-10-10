import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioKind } from '../../protocol/studio-agent-types'
import {
  readStudioSceneSelection,
  writeStudioSceneSelection,
} from '../../session-history/session-storage'
import {
  planStudioCinemaSceneSelection,
  type StudioCinemaSceneSelectionStore,
} from './scene-selection-plan'

/**
 * Scene selection binding (task 11C2, corrections R1 and F1).
 *
 * Responsibilities, kept deliberately apart from the accepted controller:
 *
 * 1. **Decide once per Session, after the index is readable.** Only a readable index can settle the
 *    choice; an unreadable one leaves the phase at `awaiting`, so a transient read failure neither
 *    invents a selection nor deletes the stored one. A valid stored id wins, otherwise the first Scene
 *    of the index.
 * 2. **Persist only an applied decision**, and re-run that persistence when the phase settles even if
 *    the selection itself did not change — that is why the applied decision is *state*, not a ref.
 *    Writing is gated on the controller still owning the same Session.
 *
 * Request discipline (F1). The read is driven only by a real Session identity, an explicit retry or a
 * binding lifecycle change:
 *
 * - the caller's `readIndex` / `selectScene` / `store` / `indexSceneIds` may be new objects or
 *   functions on every render (they are inline in the workspace), so they are read through refs and the
 *   index ids through a content key. No effect depends on a caller-provided identity, which removes the
 *   repeat-read chain: a re-render can no longer restart the read, and a resolved read can no longer be
 *   cancelled by a cleanup that a new function identity triggered;
 * - the read effect's dependencies are exactly `[sessionId, retryToken]`.
 *
 * The controller keeps its own join of concurrent index reads; this hook adds no second cache and
 * never touches the accepted controller.
 */

export interface UseStudioCinemaSceneSelectionInput {
  studioKind: StudioKind
  /** The Session the controller currently owns, or null. */
  sessionId: string | null
  /** Scene ids of that Session, in server order. */
  indexSceneIds: readonly string[]
  /** The Scene the controller currently has selected. */
  currentSelection: string | null
  selectScene: (sceneId: string) => void
  /**
   * Reads this Session's Scene index and reports whether it could be read. It must verify that the
   * Session it is asked about is still the one it owns and answer `stale` otherwise.
   */
  readIndex: (sessionId: string) => Promise<'ok' | 'failed' | 'stale'>
  /** Named storage dependency; defaults to the real Scene-selection storage. */
  store?: StudioCinemaSceneSelectionStore
}

export interface UseStudioCinemaSceneSelectionResult {
  /** True once this Session's index was read successfully — also the persistence gate. */
  indexReadable: boolean
  /** True when the read failed for the current Session: the user may retry. */
  indexFailed: boolean
  retryIndex: () => void
}

interface StudioCinemaIndexReadState {
  sessionId: string
  readable: boolean
}

interface StudioCinemaAppliedSelection {
  sessionId: string
  sceneId: string | null
}

export const STUDIO_CINEMA_SCENE_SELECTION_STORE: StudioCinemaSceneSelectionStore = {
  read: (studioKind, sessionId) => readStudioSceneSelection(studioKind, sessionId),
  write: (studioKind, sessionId, sceneId) => writeStudioSceneSelection(studioKind, sessionId, sceneId),
}

export function useStudioCinemaSceneSelection(
  input: UseStudioCinemaSceneSelectionInput,
): UseStudioCinemaSceneSelectionResult {
  const { studioKind, sessionId, currentSelection } = input

  // Caller-provided values are read through refs: an inline arrow or a fresh array cannot restart the
  // read, and the effects below depend only on the Session identity, the content and the retry token.
  const selectSceneRef = useRef(input.selectScene)
  selectSceneRef.current = input.selectScene
  const readIndexRef = useRef(input.readIndex)
  readIndexRef.current = input.readIndex
  const sceneIdsRef = useRef(input.indexSceneIds)
  sceneIdsRef.current = input.indexSceneIds
  const storeRef = useRef<StudioCinemaSceneSelectionStore>(
    input.store ?? STUDIO_CINEMA_SCENE_SELECTION_STORE,
  )
  storeRef.current = input.store ?? STUDIO_CINEMA_SCENE_SELECTION_STORE

  /** Content key of the index: the ids in order, so the same index never re-decides. */
  const sceneIdsKey = useMemo(() => JSON.stringify(input.indexSceneIds), [input.indexSceneIds])

  const [readState, setReadState] = useState<StudioCinemaIndexReadState | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  /** The decision that actually landed in the controller, as state: settling must re-run persistence. */
  const [applied, setApplied] = useState<StudioCinemaAppliedSelection | null>(null)

  // One read per Session identity (plus an explicit retry). The controller joins a read that is already
  // in flight, so a StrictMode replay or a second caller reuses it instead of issuing another request.
  useEffect(() => {
    if (!sessionId) {
      setReadState(null)
      return
    }
    let cancelled = false
    void readIndexRef.current(sessionId).then(
      (outcome) => {
        if (cancelled || outcome === 'stale') {
          return
        }
        setReadState((previous) => {
          const readable = outcome === 'ok'
          if (previous && previous.sessionId === sessionId && previous.readable === readable) {
            return previous
          }
          return { sessionId, readable }
        })
      },
      () => {
        if (cancelled) {
          return
        }
        setReadState((previous) =>
          previous && previous.sessionId === sessionId && !previous.readable
            ? previous
            : { sessionId, readable: false },
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [retryToken, sessionId])

  const decision = useMemo(
    () =>
      planStudioCinemaSceneSelection({
        indexReadable: readState !== null && readState.sessionId === sessionId && readState.readable,
        indexSceneIds: sceneIdsRef.current,
        currentSelection,
        // Reading is only meaningful once this Session's index is usable; until then nothing is decided
        // and the stored value is neither read nor written.
        storedSceneId:
          readState !== null && readState.sessionId === sessionId && readState.readable
            ? storeRef.current.read(studioKind, sessionId ?? '')
            : null,
      }),
    // `sceneIdsKey` carries the index content; the refs above are intentionally not dependencies.
    [currentSelection, readState, sceneIdsKey, sessionId, studioKind],
  )

  // Apply the decision. A decision the controller did not apply (a stale generation, a vanished Scene)
  // stays unapplied, so persistence keeps waiting instead of storing a value nobody shows.
  useEffect(() => {
    if (decision.kind !== 'settled' || sessionId === null) {
      setApplied((previous) => (previous === null ? previous : null))
      return
    }
    if (decision.select !== null && decision.select !== currentSelection) {
      setApplied((previous) => (previous === null ? previous : null))
      selectSceneRef.current(decision.select)
      return
    }
    const sceneId = decision.select ?? currentSelection
    setApplied((previous) =>
      previous && previous.sessionId === sessionId && previous.sceneId === sceneId
        ? previous
        : { sessionId, sceneId },
    )
  }, [currentSelection, decision, sessionId])

  // Persist only an applied decision of the *current* Session. Depending on `applied` (state) as well as
  // on the selection is what makes a settle without a selection change persist too — a ref update alone
  // would not re-run this effect.
  useEffect(() => {
    if (sessionId === null || applied === null || applied.sessionId !== sessionId) {
      return
    }
    storeRef.current.write(studioKind, sessionId, currentSelection)
  }, [applied, currentSelection, sessionId, studioKind])

  const retryIndex = useCallback(() => {
    setRetryToken((token) => token + 1)
  }, [])

  return {
    indexReadable: readState !== null && readState.sessionId === sessionId && readState.readable,
    indexFailed: readState !== null && readState.sessionId === sessionId && !readState.readable,
    retryIndex,
  }
}
