/**
 * Scene selection plan (task 11C2, correction R1).
 *
 * A Session's Scene index is read asynchronously, and a Session can be opened with a stored Scene id
 * that no longer exists. The rule that decides what the workspace should open therefore has an
 * explicit *phase*: nothing is decided — and nothing is written back — until this Session's index was
 * read successfully. An unreadable index is not an empty index: a failed read must never look like
 * "this Session has no Scenes", and it must never delete the stored choice.
 *
 * The decision is a pure function of the stored id, the index and the controller's current selection,
 * so the phase can be tested without a browser and the persistence gate can be stated exactly.
 */

export interface StudioCinemaSceneSelectionStore {
  read: (studioKind: string, sessionId: string) => string | null
  write: (studioKind: string, sessionId: string, sceneId: string | null) => void
}

export interface StudioCinemaSceneSelectionPlanInput {
  /** `false` while the index of this Session has not been read successfully (or the read failed). */
  indexReadable: boolean
  /** Scene ids in server order. */
  indexSceneIds: readonly string[]
  /** What the controller currently has selected, or null. */
  currentSelection: string | null
  /** The stored choice for this Session, if any. */
  storedSceneId: string | null
}

export type StudioCinemaSceneSelectionReason = 'kept' | 'stored' | 'first' | 'empty'

export type StudioCinemaSceneSelectionPlan =
  /** The index is not usable yet: decide nothing, write nothing, keep the stored choice. */
  | { kind: 'awaiting-index' }
  | {
      kind: 'settled'
      /** A Scene to select, or null when the controller already has a valid one / there is none. */
      select: string | null
      reason: StudioCinemaSceneSelectionReason
    }

/**
 * Whether a Scene-index read may be issued at all (correction F1).
 *
 * The read carries an identity promise: it is asked about one Session, and it may only be issued while
 * the controller still owns that very Session. A mismatch is answered as `stale` *before* any request,
 * so a signature can never be used to read a Session the caller no longer owns.
 */
export function isStudioCinemaIndexReadTarget(input: {
  controllerSessionId: string | null
  expectedSessionId: string
}): boolean {
  return (
    input.controllerSessionId !== null && input.controllerSessionId === input.expectedSessionId
  )
}

export function planStudioCinemaSceneSelection(
  input: StudioCinemaSceneSelectionPlanInput,
): StudioCinemaSceneSelectionPlan {
  if (!input.indexReadable) {
    return { kind: 'awaiting-index' }
  }

  const sceneIds = input.indexSceneIds
  const current = input.currentSelection
  if (current !== null && sceneIds.includes(current)) {
    // The controller already shows a Scene of this Session's current index: never fight it.
    return { kind: 'settled', select: null, reason: 'kept' }
  }

  if (sceneIds.length === 0) {
    // Read successfully and genuinely empty: a stale stored id is meaningless here.
    return { kind: 'settled', select: null, reason: 'empty' }
  }

  const stored = input.storedSceneId
  if (stored !== null && sceneIds.includes(stored)) {
    return { kind: 'settled', select: stored, reason: 'stored' }
  }

  // No stored choice, or the stored Scene is gone: the first Scene of the index is the default.
  return { kind: 'settled', select: sceneIds[0] ?? null, reason: 'first' }
}
