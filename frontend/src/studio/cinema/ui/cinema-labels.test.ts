import { describe, expect, it } from 'vitest'
import type { StudioTokenUsage } from '../../protocol/studio-agent-types'
import {
  formatStudioCinemaElapsed,
  readStudioCinemaCatStatus,
  readStudioCinemaFeedbackKey,
  readStudioCinemaFeedbackTone,
  readStudioCinemaRenderStatusKey,
  readStudioCinemaRunStatusKey,
  readStudioCinemaSceneStatusKey,
  readStudioCinemaScreenState,
  readStudioCinemaSubmitBlockedKey,
  readStudioCinemaTokenSummary,
  type StudioCinemaScreenState,
} from './cinema-labels'
import { createInitialStudioCinemaRenderRefreshState } from '../types'

/**
 * Display-rule specs (task 11C2, sections 6 to 8).
 *
 * These rules decide what the user reads, so they are pure and asserted directly: no render, no
 * network. Two of them are honesty rules — an unmeasured token total is never `0`, and a transport
 * problem is never reported as a failed render.
 */

function usage(input?: Partial<StudioTokenUsage>): StudioTokenUsage {
  return {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    measuredCalls: 1,
    unmeasuredCalls: 0,
    ...input,
  }
}

function catInput(
  overrides: Partial<Parameters<typeof readStudioCinemaCatStatus>[0]> = {},
): Parameters<typeof readStudioCinemaCatStatus>[0] {
  return {
    sceneIndex: 0,
    submitting: false,
    hasActiveRun: false,
    hasActiveRender: false,
    needsReconciliation: false,
    snapshotStatus: 'ready',
    streamState: 'connected',
    renderRefresh: createInitialStudioCinemaRenderRefreshState(),
    hasFailedOutcome: false,
    ...overrides,
  }
}

describe('cinema display rules', () => {
  it('reuses the shared run and render status vocabulary', () => {
    expect(readStudioCinemaRunStatusKey('running')).toBe('studio.runStatus.running')
    expect(readStudioCinemaRunStatusKey('cancelled')).toBe('studio.runStatus.cancelled')
    expect(readStudioCinemaRenderStatusKey('queued')).toBe('studio.renderStatus.queued')
    expect(readStudioCinemaRenderStatusKey('completed')).toBe('studio.renderStatus.completed')
  })

  it('orders the scene badge by what the user has to do next', () => {
    const base = { isBusy: false, snapshotStatus: 'ready' as const, hasFailedOutcome: false, needsReconciliation: false, streamState: 'connected' as const }
    expect(readStudioCinemaSceneStatusKey(base)).toBe('studio.cinema.sceneStatusReady')
    expect(readStudioCinemaSceneStatusKey({ ...base, isBusy: true })).toBe('studio.cinema.sceneStatusBusy')
    expect(readStudioCinemaSceneStatusKey({ ...base, hasFailedOutcome: true })).toBe('studio.cinema.sceneStatusFailed')
    expect(readStudioCinemaSceneStatusKey({ ...base, needsReconciliation: true })).toBe(
      'studio.cinema.sceneStatusNeedsCheck',
    )
    expect(readStudioCinemaSceneStatusKey({ ...base, snapshotStatus: 'error' })).toBe(
      'studio.cinema.sceneStatusUnreachable',
    )
  })

  it('lets the cat report the most actionable fact of its own scene', () => {
    expect(readStudioCinemaCatStatus(catInput()).key).toBe('studio.cinema.catIdle')
    expect(readStudioCinemaCatStatus(catInput({ hasActiveRender: true })).key).toBe('studio.cinema.catWorking')
    expect(readStudioCinemaCatStatus(catInput({ submitting: true })).key).toBe('studio.cinema.catSubmitting')
    expect(readStudioCinemaCatStatus(catInput({ hasFailedOutcome: true })).key).toBe('studio.cinema.catFailed')
    expect(readStudioCinemaCatStatus(catInput({ needsReconciliation: true })).key).toBe(
      'studio.cinema.catNeedsCheck',
    )
    expect(readStudioCinemaCatStatus(catInput({ snapshotStatus: 'error' })).key).toBe(
      'studio.cinema.catUnreachable',
    )
    expect(
      readStudioCinemaCatStatus(
        catInput({ renderRefresh: { status: 'paused', pauseReason: 'budget', refreshes: 60, consecutiveFailures: 0 } }),
      ).key,
    ).toBe('studio.cinema.catRefreshPaused')
    // A dropped stream is a transport fact the cat may mention, and never a failed render.
    expect(readStudioCinemaCatStatus(catInput({ streamState: 'disconnected' })).key).toBe(
      'studio.cinema.catReconnecting',
    )
    expect(readStudioCinemaCatStatus(catInput({ hasActiveRender: true, streamState: 'reconnecting' })).key).toBe(
      'studio.cinema.catWorking',
    )
  })

  it('keeps a playable result on screen ahead of newer work and separates the gaps', () => {
    const base: Parameters<typeof readStudioCinemaScreenState>[0] = {
      playableUrl: null,
      capabilityGap: false,
      hasActiveRender: false,
      latestStatus: null,
    }
    const cases: Array<[Parameters<typeof readStudioCinemaScreenState>[0], StudioCinemaScreenState]> = [
      [base, 'empty'],
      [{ ...base, hasActiveRender: true }, 'rendering'],
      [{ ...base, latestStatus: 'failed' }, 'failed'],
      [{ ...base, latestStatus: 'completed', capabilityGap: true }, 'media_gap'],
      [{ ...base, playableUrl: '/videos/job.mp4', latestStatus: 'failed' }, 'playable'],
      [{ ...base, playableUrl: '/videos/job.mp4', hasActiveRender: true }, 'playable'],
    ]
    for (const [input, expected] of cases) {
      expect(readStudioCinemaScreenState(input)).toBe(expected)
    }
  })

  it('never reports an unmeasured token total as zero', () => {
    expect(readStudioCinemaTokenSummary(null)).toEqual({
      measured: false,
      totalTokens: 0,
      measuredCalls: 0,
      unmeasuredCalls: 0,
    })
    expect(readStudioCinemaTokenSummary(usage({ measuredCalls: 0, unmeasuredCalls: 3, totalTokens: 0 }))).toEqual({
      measured: false,
      totalTokens: 0,
      measuredCalls: 0,
      unmeasuredCalls: 3,
    })
    expect(readStudioCinemaTokenSummary(usage())).toEqual({
      measured: true,
      totalTokens: 15,
      measuredCalls: 1,
      unmeasuredCalls: 0,
    })
  })

  it('formats a display-only elapsed time', () => {
    expect(formatStudioCinemaElapsed('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:01:05.000Z'))).toBe('1:05')
    expect(formatStudioCinemaElapsed('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T02:05:00.000Z'))).toBe('2h 05m')
    expect(formatStudioCinemaElapsed('not-a-date', Date.parse('2026-01-01T00:00:00.000Z'))).toBe('')
  })

  it('maps every feedback code and submit block reason to a stable local key', () => {
    expect(readStudioCinemaFeedbackKey('scene_create_failed')).toBe('studio.cinema.feedbackSceneCreateFailed')
    expect(readStudioCinemaFeedbackKey('stream_resync')).toBe('studio.cinema.feedbackStreamResync')
    expect(readStudioCinemaFeedbackTone('scene_create_failed')).toBe('error')
    expect(readStudioCinemaFeedbackTone('stream_resync')).toBe('warning')
    expect(readStudioCinemaSubmitBlockedKey('active_run')).toBe('studio.cinema.submitBlockedActiveRun')
    expect(readStudioCinemaSubmitBlockedKey('reconciliation')).toBe('studio.cinema.submitBlockedReconciliation')
    expect(readStudioCinemaSubmitBlockedKey('loading')).toBe('studio.cinema.submitBlockedLoading')
    expect(readStudioCinemaSubmitBlockedKey('snapshot_failed')).toBe('studio.cinema.submitBlockedSnapshotFailed')
    expect(readStudioCinemaSubmitBlockedKey('empty_draft')).toBe('studio.cinema.submitBlockedEmptyDraft')
    expect(readStudioCinemaSubmitBlockedKey('submitting')).toBe('studio.cinema.submitBlockedSubmitting')
  })
})
