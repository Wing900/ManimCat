/**
 * Stable feedback codes for Scene request failures.
 *
 * A thrown request error is mapped to a definite or unknown outcome: only a transport-level failure
 * (no HTTP answer, an unparsable body, or an abort) is unknown, so the caller reconciles instead of
 * blindly retrying. A server envelope error is a definite answer. The snapshot outcome union lives
 * here too because the snapshot read and its error mapping are one concern.
 */
import type { StudioCinemaFeedbackCode } from './types'
import { StudioApiRequestError } from '../api/client'

export type StudioCinemaRequestKind =
  | 'scene_create'
  | 'scene_reorder'
  | 'run_submit'
  | 'run_cancel'
  | 'snapshot'

/** Result of one Scene snapshot read; `superseded` means a newer read of the same Scene owns it. */
export type StudioCinemaSnapshotOutcome = 'ok' | 'failed' | 'stale' | 'superseded'

export interface StudioCinemaRequestError {
  code: StudioCinemaFeedbackCode
  /** True when the server may still have applied the request: reconcile, never blindly retry. */
  unknownOutcome: boolean
}

/**
 * Maps a thrown request error to a stable feedback code. Only a transport-level failure (no HTTP
 * answer, unparsable body, abort) is an unknown outcome; a server envelope error is a definite
 * answer.
 */
export function readStudioCinemaRequestError(
  kind: StudioCinemaRequestKind,
  error: unknown,
): StudioCinemaRequestError {
  if (error instanceof StudioApiRequestError) {
    if (error.code === 'STUDIO_REQUEST_FAILED') {
      return { code: unknownOutcomeCode(kind), unknownOutcome: true }
    }
    if (error.code === 'WORK_CONFLICT') {
      return { code: kind === 'run_submit' ? 'run_submit_conflict' : 'scene_create_failed', unknownOutcome: false }
    }
    if (error.code === 'NOT_FOUND') {
      return { code: 'session_not_found', unknownOutcome: false }
    }
    return { code: definiteFailureCode(kind), unknownOutcome: false }
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: unknownOutcomeCode(kind), unknownOutcome: true }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: unknownOutcomeCode(kind), unknownOutcome: true }
  }

  return { code: unknownOutcomeCode(kind), unknownOutcome: true }
}

function definiteFailureCode(kind: StudioCinemaRequestKind): StudioCinemaFeedbackCode {
  switch (kind) {
    case 'scene_create':
    case 'scene_reorder':
      return 'scene_create_failed'
    case 'run_cancel':
      return 'run_cancel_failed'
    case 'snapshot':
      return 'snapshot_failed'
    case 'run_submit':
    default:
      return 'run_submit_failed'
  }
}

function unknownOutcomeCode(kind: StudioCinemaRequestKind): StudioCinemaFeedbackCode {
  switch (kind) {
    case 'scene_create':
    case 'scene_reorder':
      return 'scene_create_unknown'
    case 'run_submit':
      return 'run_submit_unknown'
    case 'run_cancel':
      return 'run_cancel_failed'
    case 'snapshot':
    default:
      return 'snapshot_failed'
  }
}