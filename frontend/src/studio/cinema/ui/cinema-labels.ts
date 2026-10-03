import type { TranslationKey } from '../../../i18n/messages'
import type {
  StudioRenderStatus,
  StudioRunStatus,
  StudioTokenUsage,
} from '../../protocol/studio-agent-types'
import type { StudioCinemaSubmitBlockReason } from '../scene-selectors'
import type {
  StudioCinemaFeedbackCode,
  StudioCinemaRenderRefreshState,
  StudioCinemaStreamState,
} from '../types'

/**
 * Display rules of the Cinema UI (task 11C2), kept pure so they can be asserted without rendering.
 *
 * Everything here is a *label decision*: which translation key describes a Run, a render, a stream or
 * the cat's one status sentence, and how a time or a token total is shown. Two rules are deliberate:
 * a missing measurement is never rendered as a zero, and the cat's sentence always comes from the
 * public Scene view — never from an internal error, a server path or a job id.
 */

/** Priority of the cat's single sentence: the most actionable fact of this Scene wins. */
export interface StudioCinemaCatStatus {
  key: TranslationKey
  params?: Record<string, number | string>
  tone: 'idle' | 'busy' | 'warning' | 'error'
}

export function readStudioCinemaSceneLabelKey(): TranslationKey {
  return 'studio.cinema.sceneLabel'
}

export function readStudioCinemaRunStatusKey(status: StudioRunStatus): TranslationKey {
  switch (status) {
    case 'pending':
      return 'studio.runStatus.pending'
    case 'running':
      return 'studio.runStatus.running'
    case 'completed':
      return 'studio.runStatus.completed'
    case 'failed':
      return 'studio.runStatus.failed'
    case 'cancelled':
      return 'studio.runStatus.cancelled'
  }
}

export function readStudioCinemaRenderStatusKey(status: StudioRenderStatus): TranslationKey {
  switch (status) {
    case 'queued':
      return 'studio.renderStatus.queued'
    case 'running':
      return 'studio.renderStatus.running'
    case 'completed':
      return 'studio.renderStatus.completed'
    case 'failed':
      return 'studio.renderStatus.failed'
    case 'cancelled':
      return 'studio.renderStatus.cancelled'
  }
}

export function readStudioCinemaStreamStateKey(state: StudioCinemaStreamState): TranslationKey {
  switch (state) {
    case 'idle':
      return 'studio.cinema.streamIdle'
    case 'connecting':
      return 'studio.cinema.streamConnecting'
    case 'connected':
      return 'studio.cinema.streamConnected'
    case 'reconnecting':
      return 'studio.cinema.streamReconnecting'
    case 'disconnected':
      return 'studio.cinema.streamDisconnected'
  }
}

/** Lightweight Scene state for the strip and the sidebar; a background Scene is never "live". */
export function readStudioCinemaSceneStatusKey(input: {
  isBusy: boolean
  snapshotStatus: 'idle' | 'loading' | 'ready' | 'error'
  hasFailedOutcome: boolean
  needsReconciliation: boolean
  streamState: StudioCinemaStreamState
}): TranslationKey {
  if (input.needsReconciliation) {
    return 'studio.cinema.sceneStatusNeedsCheck'
  }
  if (input.hasFailedOutcome) {
    return 'studio.cinema.sceneStatusFailed'
  }
  if (input.isBusy) {
    return 'studio.cinema.sceneStatusBusy'
  }
  if (input.snapshotStatus === 'error') {
    return 'studio.cinema.sceneStatusUnreachable'
  }
  if (input.snapshotStatus === 'loading' || input.streamState === 'connecting') {
    return 'studio.cinema.sceneStatusLoading'
  }
  return 'studio.cinema.sceneStatusReady'
}

/**
 * The cat says exactly one thing about the Scene it is standing next to. The order is the order of
 * what the user should do next; none of these cases lets an internal error text through.
 */
export function readStudioCinemaCatStatus(input: {
  sceneIndex: number
  submitting: boolean
  hasActiveRun: boolean
  hasActiveRender: boolean
  needsReconciliation: boolean
  snapshotStatus: 'idle' | 'loading' | 'ready' | 'error'
  streamState: StudioCinemaStreamState
  renderRefresh: StudioCinemaRenderRefreshState
  hasFailedOutcome: boolean
}): StudioCinemaCatStatus {
  const params = { index: input.sceneIndex + 1 }

  if (input.snapshotStatus === 'error') {
    return { key: 'studio.cinema.catUnreachable', params, tone: 'warning' }
  }
  if (input.needsReconciliation) {
    return { key: 'studio.cinema.catNeedsCheck', params, tone: 'warning' }
  }
  if (input.submitting) {
    return { key: 'studio.cinema.catSubmitting', params, tone: 'busy' }
  }
  if (input.hasActiveRun || input.hasActiveRender) {
    return { key: 'studio.cinema.catWorking', params, tone: 'busy' }
  }
  if (input.renderRefresh.status === 'paused') {
    return { key: 'studio.cinema.catRefreshPaused', params, tone: 'warning' }
  }
  if (input.streamState !== 'connected' && input.snapshotStatus === 'ready') {
    return { key: 'studio.cinema.catReconnecting', params, tone: 'warning' }
  }
  if (input.hasFailedOutcome) {
    return { key: 'studio.cinema.catFailed', params, tone: 'error' }
  }
  return { key: 'studio.cinema.catIdle', params, tone: 'idle' }
}

/** Session-level feedback: one stable key per code, never a raw server message. */
export function readStudioCinemaFeedbackKey(code: StudioCinemaFeedbackCode): TranslationKey {
  switch (code) {
    case 'scene_create_failed':
      return 'studio.cinema.feedbackSceneCreateFailed'
    case 'scene_create_unknown':
      return 'studio.cinema.feedbackSceneCreateUnknown'
    case 'scene_initialize_partial':
      return 'studio.cinema.feedbackInitializePartial'
    case 'session_not_found':
      return 'studio.cinema.feedbackSessionNotFound'
    case 'provider_incomplete':
      return 'studio.cinema.feedbackProviderIncomplete'
    case 'provider_unavailable':
      return 'studio.cinema.feedbackProviderUnavailable'
    case 'run_submit_failed':
      return 'studio.cinema.feedbackRunSubmitFailed'
    case 'run_submit_conflict':
      return 'studio.cinema.feedbackRunSubmitConflict'
    case 'run_submit_unknown':
      return 'studio.cinema.feedbackRunSubmitUnknown'
    case 'run_cancel_failed':
      return 'studio.cinema.feedbackRunCancelFailed'
    case 'snapshot_failed':
      return 'studio.cinema.feedbackSnapshotFailed'
    case 'stream_resync':
      return 'studio.cinema.feedbackStreamResync'
    case 'stream_disconnected':
      return 'studio.cinema.feedbackStreamDisconnected'
  }
}

export function readStudioCinemaFeedbackTone(code: StudioCinemaFeedbackCode): 'error' | 'warning' {
  return code.startsWith('scene_') || code.startsWith('run_') || code.startsWith('provider_')
    ? 'error'
    : 'warning'
}

export function readStudioCinemaSubmitBlockedKey(reason: StudioCinemaSubmitBlockReason): TranslationKey {
  switch (reason) {
    case 'loading':
      return 'studio.cinema.submitBlockedLoading'
    case 'snapshot_failed':
      return 'studio.cinema.submitBlockedSnapshotFailed'
    case 'empty_draft':
      return 'studio.cinema.submitBlockedEmptyDraft'
    case 'submitting':
      return 'studio.cinema.submitBlockedSubmitting'
    case 'active_run':
      return 'studio.cinema.submitBlockedActiveRun'
    case 'reconciliation':
      return 'studio.cinema.submitBlockedReconciliation'
  }
}

export type StudioCinemaScreenState = 'empty' | 'rendering' | 'failed' | 'media_gap' | 'playable'

/**
 * What the screen shows. A playable result always wins, so a newer unfinished render can never hide
 * the video that is already on screen.
 */
export function readStudioCinemaScreenState(input: {
  playableUrl: string | null
  capabilityGap: boolean
  hasActiveRender: boolean
  latestStatus: StudioRenderStatus | null
}): StudioCinemaScreenState {
  if (input.playableUrl) {
    return 'playable'
  }
  if (input.latestStatus === 'failed' || input.latestStatus === 'cancelled') {
    return 'failed'
  }
  if (input.latestStatus === 'completed' && input.capabilityGap) {
    return 'media_gap'
  }
  if (input.hasActiveRender || input.latestStatus === 'queued' || input.latestStatus === 'running') {
    return 'rendering'
  }
  return 'empty'
}

/**
 * Token total of a Scene. A Scene whose calls were never measured reports the gap instead of a zero,
 * because `0` would be a measurement claim the client cannot make.
 */
export interface StudioCinemaTokenSummary {
  measured: boolean
  totalTokens: number
  measuredCalls: number
  unmeasuredCalls: number
}

export function readStudioCinemaTokenSummary(usage: StudioTokenUsage | null): StudioCinemaTokenSummary {
  if (!usage) {
    return { measured: false, totalTokens: 0, measuredCalls: 0, unmeasuredCalls: 0 }
  }
  return {
    measured: usage.measuredCalls > 0,
    totalTokens: usage.totalTokens,
    measuredCalls: usage.measuredCalls,
    unmeasuredCalls: usage.unmeasuredCalls,
  }
}

/** Elapsed time of one Run, display-only. Hours only appear when they exist. */
export function formatStudioCinemaElapsed(fromIso: string, toMs: number): string {
  const from = Date.parse(fromIso)
  if (!Number.isFinite(from)) {
    return ''
  }
  const seconds = Math.max(0, Math.floor((toMs - from) / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** Local wall-clock time of one record, for the activity strip. */
export function formatStudioCinemaClockTime(iso: string, locale: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) {
    return ''
  }
  return new Date(at).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
