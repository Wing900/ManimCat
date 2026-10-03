import type {
  StudioRenderStatus,
  StudioRunStatus,
  StudioScene,
  StudioSceneAttachment,
  StudioSceneMessage,
  StudioSceneRender,
  StudioSceneRun,
} from '../protocol/studio-agent-types'

/**
 * Scene client foundation for the Cinema UI (task 11C1).
 *
 * Everything below is Scene-scoped: one Session owns an ordered list of Scenes, and every Scene owns
 * its own conversation, Runs, renders, draft and submission state. Identity is always the pair
 * `(sessionId, sceneId)`; a Scene id alone is never a key, so a Scene id from another Session can
 * never address a record here.
 *
 * Lifecycle: the controller is reentrant. `detach` (an effect cleanup) stops network work and keeps
 * the instance reusable, while `dispose` is terminal. Recovery is connect-then-snapshot: no
 * authoritative read happens before the stream reported a real connection.
 */

export interface StudioCinemaSceneIdentity {
  sessionId: string
  sceneId: string
}

/**
 * Composite map key. The separator is a NUL character, which the shared Scene scope rule already
 * refuses in any identifier, so two different identities can never collide into one key.
 */
export const STUDIO_CINEMA_KEY_SEPARATOR = '\u0000'

export function buildStudioCinemaSceneKey(identity: StudioCinemaSceneIdentity): string {
  return `${identity.sessionId}${STUDIO_CINEMA_KEY_SEPARATOR}${identity.sceneId}`
}

export function isSameStudioCinemaScene(
  left: StudioCinemaSceneIdentity | null,
  right: StudioCinemaSceneIdentity | null,
): boolean {
  return left !== null && right !== null && left.sessionId === right.sessionId && left.sceneId === right.sceneId
}

/**
 * Stable, translatable user feedback codes. The UI maps a code to a message; no internal error text
 * and no server path ever reaches the Scene state or the chat transcript.
 */
export type StudioCinemaFeedbackCode =
  | 'scene_create_failed'
  | 'scene_create_unknown'
  | 'scene_initialize_partial'
  | 'session_not_found'
  | 'provider_incomplete'
  | 'provider_unavailable'
  | 'run_submit_failed'
  | 'run_submit_conflict'
  | 'run_submit_unknown'
  | 'run_cancel_failed'
  | 'snapshot_failed'
  | 'stream_resync'
  | 'stream_disconnected'

export type StudioCinemaErrorCode = StudioCinemaFeedbackCode | 'invalid_request' | 'service_unavailable' | 'unknown'

export interface StudioCinemaFeedback {
  code: StudioCinemaFeedbackCode
  /** True when the outcome of the request is unknown and needs reconciliation, never a blind retry. */
  needsReconciliation: boolean
}

export type StudioCinemaStreamState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/**
 * Render refresh loop (task 11C1M): while the selected Scene still has a Manim render that has not
 * finished, the client asks the server for that Scene again, because the render is completed by the
 * Manim job rather than by the Agent Run. All four bounds are named so a review can see them.
 */
export const STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS = 3000
export const STUDIO_CINEMA_RENDER_REFRESH_BACKOFF_MAX_MS = 30000
export const STUDIO_CINEMA_RENDER_REFRESH_MAX_CONSECUTIVE_FAILURES = 5
export const STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT = 60

export type StudioCinemaRenderRefreshStatus = 'idle' | 'active' | 'paused'

/** Why automatic refreshing stopped: it never claims the render finished. */
export type StudioCinemaRenderRefreshPauseReason = 'failures' | 'budget'

export interface StudioCinemaRenderRefreshState {
  status: StudioCinemaRenderRefreshStatus
  pauseReason: StudioCinemaRenderRefreshPauseReason | null
  /** Reads performed for this Scene by the loop; a manual resume grants a fresh budget. */
  refreshes: number
  consecutiveFailures: number
}

export function createInitialStudioCinemaRenderRefreshState(): StudioCinemaRenderRefreshState {
  return { status: 'idle', pauseReason: null, refreshes: 0, consecutiveFailures: 0 }
}

export type StudioCinemaSnapshotStatus = 'idle' | 'loading' | 'ready' | 'error'

export type StudioCinemaInitializationStatus = 'idle' | 'creating' | 'partial' | 'ready' | 'failed'

export interface StudioCinemaInitializationState {
  status: StudioCinemaInitializationStatus
  /** Scenes created by this workflow, including the ones that survived a partial failure. */
  createdCount: number
  /** Target Scene count of a fresh Session; the append action has no client-side cap. */
  targetCount: number
  workflowId: string | null
  feedback: StudioCinemaFeedback | null
}

/** Per-Scene state. One entry per `(sessionId, sceneId)`; sibling Scenes never share a field. */
export interface StudioCinemaSceneState {
  identity: StudioCinemaSceneIdentity
  scene: StudioScene
  messages: StudioSceneMessage[]
  runs: StudioSceneRun[]
  renders: StudioSceneRender[]
  draft: string
  /** Bumped on every draft edit, so a submit can clear only the text it actually captured. */
  draftVersion: number
  submitting: boolean
  submittedDraftVersion: number | null
  cancelRequested: boolean
  /** A submit whose outcome is unknown: reconciliation is offered instead of an automatic retry. */
  needsReconciliation: boolean
  snapshotStatus: StudioCinemaSnapshotStatus
  streamState: StudioCinemaStreamState
  streamAttempt: number
  /** Events dropped because the recovery buffer overflowed and the snapshot was re-read instead. */
  resyncedAt: number | null
  /**
   * True while a recovery window could not be proven complete: assistant deltas that arrived inside
   * that window were discarded instead of being merged on top of the authoritative snapshot, so the
   * Scene converges again at the next checkpoint. The client never claims exactly-once delivery.
   */
  convergencePending: boolean
  /** Bounded, non-overlapping refresh of this Scene while its Manim render is unfinished. */
  renderRefresh: StudioCinemaRenderRefreshState
  feedback: StudioCinemaFeedback | null
}

export interface StudioCinemaSessionState {
  id: string | null
  generation: number
  title: string | null
  projectId: string | null
}

export interface StudioCinemaState {
  session: StudioCinemaSessionState
  /** Scene ids in display order; the Scene records live in `scenes`, keyed by identity. */
  sceneOrder: string[]
  scenes: Record<string, StudioCinemaSceneState>
  selectedSceneId: string | null
  initialization: StudioCinemaInitializationState
  /** True while the single Session mutation lane holds or runs at least one Scene request. */
  sceneMutationPending: boolean
  /** Session-level feedback: initialization, append and session loading. */
  feedback: StudioCinemaFeedback | null
}

/** Events delivered by one Scene stream, already narrowed to the Scene public projection. */
export type StudioCinemaSceneEvent =
  | { kind: 'connection'; state: 'connected' | 'heartbeat'; timestamp: number }
  | { kind: 'run-updated'; run: StudioSceneRun }
  | { kind: 'render-updated'; render: StudioSceneRender }
  | { kind: 'assistant-text'; runId: string; messageId: string; text: string }
  | { kind: 'tool-input-start'; runId: string; messageId: string; toolName: string; callId: string }
  | { kind: 'tool-call'; runId: string; messageId: string; toolName: string; callId: string }
  | {
      kind: 'tool-result'
      runId: string
      messageId: string
      toolName: string
      callId: string
      status: 'completed' | 'failed'
      title?: string
      output?: string
      metadata?: Record<string, unknown>
      attachments?: StudioSceneAttachment[]
    }

/**
 * Assistant text is the one event kind that cannot be proven non-overlapping with an authoritative
 * snapshot: the protocol has no event cursor, so a delta that arrived inside a recovery window may
 * or may not already be inside the snapshot. Every other kind is an idempotent record upsert keyed
 * by id and can be replayed safely.
 */
export function isStudioCinemaTextDeltaEvent(event: StudioCinemaSceneEvent): boolean {
  return event.kind === 'assistant-text'
}

/**
 * One decoded Scene frame with the verified scope it belongs to. `identity` is `null` only for the
 * connection frames (`studio.connected` / `studio.heartbeat`), which carry no Scene at all.
 */
export interface StudioCinemaScopedSceneEvent {
  identity: StudioCinemaSceneIdentity | null
  event: StudioCinemaSceneEvent
}

export const STUDIO_CINEMA_DEFAULT_SCENE_COUNT = 3

/**
 * Bound on the record events kept for one recovery window. Assistant text is never buffered (it is
 * discarded and reported as a pending convergence), so this bound only covers idempotent records;
 * an overflow stops claiming the window is complete and re-reads the snapshot instead.
 */
export const STUDIO_CINEMA_RECOVERY_BUFFER_LIMIT = 256

const TERMINAL_RUN_STATUSES: ReadonlySet<StudioRunStatus> = new Set(['completed', 'failed', 'cancelled'])
const TERMINAL_RENDER_STATUSES: ReadonlySet<StudioRenderStatus> = new Set(['completed', 'failed', 'cancelled'])
const ACTIVE_RUN_STATUSES: ReadonlySet<StudioRunStatus> = new Set(['pending', 'running'])

export function isStudioCinemaTerminalRunStatus(status: StudioRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status)
}

export function isStudioCinemaTerminalRenderStatus(status: StudioRenderStatus): boolean {
  return TERMINAL_RENDER_STATUSES.has(status)
}

export function isStudioCinemaActiveRunStatus(status: StudioRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status)
}

/** Render statuses that are still moving: the bounded refresh loop follows exactly these. */
const ACTIVE_RENDER_STATUSES: ReadonlySet<StudioRenderStatus> = new Set(['queued', 'running'])

export function isStudioCinemaActiveRenderStatus(status: StudioRenderStatus): boolean {
  return ACTIVE_RENDER_STATUSES.has(status)
}

export function createInitialStudioCinemaState(): StudioCinemaState {
  return {
    session: { id: null, generation: 0, title: null, projectId: null },
    sceneOrder: [],
    scenes: {},
    selectedSceneId: null,
    initialization: {
      status: 'idle',
      createdCount: 0,
      targetCount: STUDIO_CINEMA_DEFAULT_SCENE_COUNT,
      workflowId: null,
      feedback: null,
    },
    sceneMutationPending: false,
    feedback: null,
  }
}
