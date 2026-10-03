import { describe, expect, it } from 'vitest'
import type { StudioScene, StudioSceneAttachment, StudioSceneRun, StudioTokenUsage } from '../protocol/studio-agent-types'
import { studioCinemaReducer, type StudioCinemaAction } from './scene-reducer'
import {
  readStudioCinemaActiveRender,
  readStudioCinemaActiveRenderIds,
  readStudioCinemaRenderWaitTarget,
  readStudioCinemaSceneEligibility,
  selectStudioCinemaDisplayRender,
  selectStudioCinemaSceneCumulativeTokenUsage,
  selectStudioCinemaSceneIndex,
  selectStudioCinemaSceneView,
  selectStudioCinemaUserStatus,
} from './scene-selectors'
import {
  readStudioCinemaDataUri,
  readStudioCinemaHttpMediaUrl,
  readStudioCinemaMediaKind,
  readStudioCinemaMediaLocator,
  readStudioCinemaPlayableMedia,
  readStudioCinemaSameOriginMediaLocator,
  STUDIO_CINEMA_MEDIA_DATA_URI_MAX_LENGTH,
  STUDIO_CINEMA_MEDIA_URL_MAX_LENGTH,
} from './media-locators'
import { buildStudioCinemaSceneKey, createInitialStudioCinemaState, type StudioCinemaState } from './types'
import {
  CINEMA_TEST_SCENE_A,
  CINEMA_TEST_SCENE_B,
  CINEMA_TEST_SESSION_ID,
  createTestDataUri,
  createTestRender,
  createTestRun,
  createTestScene,
} from './cinema-fixtures'

/**
 * Scene selector specs (task 11C1, section 7, and the R4/R6 corrections). Two rules are the
 * interesting part: submit/cancel capability is one pure function the controller also enforces, and
 * media is chosen by asking every successful render for a playable locator before picking the newest
 * one, so a newer result without playable media never hides a video that is already on screen.
 */

const IDENTITY_A = { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A }
const IDENTITY_B = { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_B }

function applyActions(state: StudioCinemaState, actions: StudioCinemaAction[]): StudioCinemaState {
  return actions.reduce((current, action) => studioCinemaReducer(current, action), state)
}

function openState(scenes: StudioScene[]): StudioCinemaState {
  const opened = studioCinemaReducer(createInitialStudioCinemaState(), {
    type: 'session/opened',
    sessionId: CINEMA_TEST_SESSION_ID,
    generation: 1,
    title: 'Cinema',
    projectId: 'project_1',
  })
  return applyActions(opened, [{ type: 'session/index', generation: 1, scenes }])
}

/** Key of one Scene record in the Scene map, built by the production helper. */
function sceneKey(sceneId: string): string {
  return buildStudioCinemaSceneKey({ sessionId: CINEMA_TEST_SESSION_ID, sceneId })
}

function sceneRecordOf(state: StudioCinemaState, sceneId: string) {
  const record = state.scenes[sceneKey(sceneId)]
  if (!record) {
    throw new Error(`missing scene record for ${sceneId}`)
  }
  return record
}

function renderEvent(
  sceneId: string,
  renderId: string,
  input: {
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    attachments?: StudioSceneAttachment[]
    updatedAt?: string
  },
): StudioCinemaAction {
  return {
    type: 'scene/event',
    identity: { sessionId: CINEMA_TEST_SESSION_ID, sceneId },
    receivedAt: 1,
    event: {
      kind: 'render-updated',
      render: createTestRender(sceneId, renderId, {
        status: input.status ?? 'completed',
        updatedAt: input.updatedAt,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      }),
    },
  }
}

describe('studio cinema scene selectors', () => {
  it('lists the ordered scene index with selection, busy and recovery flags', () => {
    const state = applyActions(
      openState([
        createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, 0),
        createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 1),
      ]),
      [
        { type: 'scene/selected', generation: 1, sceneId: CINEMA_TEST_SCENE_A },
        { type: 'submit/started', identity: IDENTITY_B },
      ],
    )

    expect(selectStudioCinemaSceneIndex(state)).toEqual([
      {
        id: CINEMA_TEST_SCENE_B,
        position: 0,
        isSelected: false,
        isBusy: true,
        snapshotStatus: 'idle',
        streamState: 'idle',
        hasFailedOutcome: false,
        needsReconciliation: false,
      },
      {
        id: CINEMA_TEST_SCENE_A,
        position: 1,
        isSelected: true,
        isBusy: false,
        snapshotStatus: 'idle',
        streamState: 'idle',
        hasFailedOutcome: false,
        needsReconciliation: false,
      },
    ])
  })

  it('keeps the previous playable video when a newer successful result has no playable locator', () => {
    const state = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      renderEvent(CINEMA_TEST_SCENE_A, 'render_done', {
        updatedAt: '2026-03-22T00:10:00.000Z',
        attachments: [{ kind: 'file', path: 'https://media.invalid/one.mp4', mimeType: 'video/mp4' }],
      }),
      renderEvent(CINEMA_TEST_SCENE_A, 'render_relative', {
        updatedAt: '2026-03-22T00:20:00.000Z',
        attachments: [{ kind: 'file', path: 'scenes/out-two.mp4', mimeType: 'video/mp4' }],
      }),
      renderEvent(CINEMA_TEST_SCENE_A, 'render_running', {
        status: 'running',
        updatedAt: '2026-03-22T00:30:00.000Z',
      }),
    ])

    const display = selectStudioCinemaDisplayRender(sceneRecordOf(state, CINEMA_TEST_SCENE_A))
    expect(display.render?.id).toBe('render_done')
    expect(display.playableUrl).toBe('https://media.invalid/one.mp4')
    expect(display.newestSuccess?.id).toBe('render_relative')
    expect(display.capabilityGap).toBe(false)
    expect(display.latest?.id).toBe('render_running')
    expect(display.latestStatus).toBe('running')
  })

  it('displays a data locator that is larger than the URL bound', () => {
    const dataUri = createTestDataUri('image/png', 4096)
    expect(dataUri.length).toBeGreaterThan(STUDIO_CINEMA_MEDIA_URL_MAX_LENGTH)

    const state = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      renderEvent(CINEMA_TEST_SCENE_A, 'render_plot', {
        attachments: [{ kind: 'file', path: dataUri, mimeType: 'image/png' }],
      }),
    ])

    const display = selectStudioCinemaDisplayRender(sceneRecordOf(state, CINEMA_TEST_SCENE_A))
    expect(display.playableUrl).toBe(dataUri)
    expect(display.mediaKind).toBe('image')
    expect(display.capabilityGap).toBe(false)
  })

  it('judges a data locator by its own MIME and reports the capability gap when nothing is playable', () => {
    const state = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      renderEvent(CINEMA_TEST_SCENE_A, 'render_zip', {
        attachments: [{ kind: 'file', path: createTestDataUri('application/zip', 16), mimeType: 'image/png' }],
      }),
    ])

    const display = selectStudioCinemaDisplayRender(sceneRecordOf(state, CINEMA_TEST_SCENE_A))
    expect(display.render).toBeNull()
    expect(display.playableUrl).toBeNull()
    expect(display.newestSuccess?.id).toBe('render_zip')
    expect(display.capabilityGap).toBe(true)

    // The locator's own MIME wins in the other direction as well: a generic claim cannot demote it.
    const promoted = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      renderEvent(CINEMA_TEST_SCENE_A, 'render_ok', {
        attachments: [
          { kind: 'file', path: createTestDataUri('video/mp4', 16), mimeType: 'application/octet-stream' },
        ],
      }),
    ])
    expect(selectStudioCinemaDisplayRender(sceneRecordOf(promoted, CINEMA_TEST_SCENE_A)).mediaKind).toBe('video')
  })

  it('keeps the placeholder when no successful render carries media at all', () => {
    const state = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      renderEvent(CINEMA_TEST_SCENE_A, 'render_failed', { status: 'failed' }),
    ])

    const display = selectStudioCinemaDisplayRender(sceneRecordOf(state, CINEMA_TEST_SCENE_A))
    expect(display.render).toBeNull()
    expect(display.newestSuccess).toBeNull()
    expect(display.latest?.id).toBe('render_failed')
    expect(display.latestStatus).toBe('failed')
    expect(display.capabilityGap).toBe(false)
  })

  it('validates an http(s) locator and a data locator with two separate rules', () => {
    expect(readStudioCinemaHttpMediaUrl('http://localhost/videos/a.mp4')).toBe('http://localhost/videos/a.mp4')
    expect(readStudioCinemaHttpMediaUrl('scenes/out.mp4')).toBeNull()
    expect(readStudioCinemaHttpMediaUrl('D:/sessions/x/out.mp4')).toBeNull()
    expect(readStudioCinemaHttpMediaUrl('/api/studio-agent/files/out.mp4')).toBeNull()
    expect(readStudioCinemaHttpMediaUrl('https://media.invalid/a b.mp4')).toBeNull()
    expect(readStudioCinemaHttpMediaUrl('https://media.invalid/\u0000x.mp4')).toBeNull()
    expect(readStudioCinemaHttpMediaUrl(`https://media.invalid/${'a'.repeat(STUDIO_CINEMA_MEDIA_URL_MAX_LENGTH)}`)).toBeNull()
    // A data locator is a payload, not a URL: the URL reader never accepts it.
    expect(readStudioCinemaHttpMediaUrl('data:video/mp4;base64,AAAA')).toBeNull()

    expect(readStudioCinemaDataUri('data:video/mp4;base64,AAAA')).toEqual({
      mimeType: 'video/mp4',
      base64: true,
      payload: 'AAAA',
    })
    expect(readStudioCinemaDataUri('data:image/png,abc')).toEqual({
      mimeType: 'image/png',
      base64: false,
      payload: 'abc',
    })
    expect(readStudioCinemaDataUri('data:video/mp4;base64,')).toBeNull()
    expect(readStudioCinemaDataUri('data:video/mp4;base64')).toBeNull()
    expect(readStudioCinemaDataUri('data:;base64,AAAA')).toBeNull()
    expect(readStudioCinemaDataUri('data:text/plain,hello')).toBeNull()
    expect(readStudioCinemaDataUri('data:video/mp4;base64,AA AA')).toBeNull()
    expect(
      readStudioCinemaDataUri(`data:image/png;base64,${'A'.repeat(STUDIO_CINEMA_MEDIA_DATA_URI_MAX_LENGTH)}`),
    ).toBeNull()
  })

  // Correction 11C6-P2: a syntactically valid `type/subtype` is not enough. Only the image/video
  // categories the cinema can display are media; every other category is refused by the one reader.
  it('accepts only image and video data URIs and refuses every other category', () => {
    expect(readStudioCinemaDataUri('DATA:Image/PNG;base64,AAAA')?.mimeType).toBe('image/png')
    expect(readStudioCinemaDataUri('data:Video/Mp4;base64,AAAA')?.mimeType).toBe('video/mp4')

    for (const uri of [
      'data:text/plain,hello',
      'data:text/plain;base64,aGVsbG8=',
      'data:text/html;base64,AAAA',
      'data:application/json;base64,AAAA',
      'data:application/octet-stream;base64,AAAA',
      'data:audio/mpeg;base64,AAAA',
    ]) {
      expect(readStudioCinemaDataUri(uri)).toBeNull()
    }
  })

  // The data-URI payload rules (bound, non-empty payload, no whitespace) stay independent of the
  // URL bound: a 3 KB image payload is legal even though it is far past the URL limit.
  it('keeps the data-URI payload rules and never applies the URL bound to a payload', () => {
    const legalImage = `data:image/png;base64,${'A'.repeat(3000)}`
    expect(readStudioCinemaDataUri(legalImage)?.payload).toHaveLength(3000)
    expect(readStudioCinemaHttpMediaUrl(legalImage)).toBeNull()
    expect(readStudioCinemaDataUri('data:image/png;base64,')).toBeNull()
    expect(readStudioCinemaDataUri('data:image/png;base64,AAAA\n')).toBeNull()
  })

  it('derives the media kind from the locator, falling back to the extension for a plain URL', () => {
    expect(readStudioCinemaMediaKind({ kind: 'file', path: 'scenes/a.mp4' })).toBe('video')
    expect(readStudioCinemaMediaKind({ kind: 'file', path: 'scenes/a.PNG' })).toBe('image')
    expect(readStudioCinemaMediaKind({ kind: 'file', path: 'data:application/zip;base64,AA' })).toBeNull()
    expect(readStudioCinemaMediaKind({ kind: 'file', path: 'scenes/a.txt' })).toBeNull()
    // A declared media MIME wins for a plain URL; the extension is only the fallback.
    expect(
      readStudioCinemaMediaKind(
        { kind: 'file', path: 'https://media.invalid/media/abc', mimeType: 'video/mp4' },
        'https://media.invalid/media/abc',
      ),
    ).toBe('video')
    expect(
      readStudioCinemaMediaKind(
        { kind: 'file', path: 'https://media.invalid/out.webm', mimeType: 'application/octet-stream' },
        'https://media.invalid/out.webm',
      ),
    ).toBe('video')

    // A playable locator of an unknown media type is still refused, so the placeholder stays.
    expect(
      readStudioCinemaPlayableMedia([
        { kind: 'file', path: 'https://media.invalid/out.bin', mimeType: 'application/octet-stream' },
      ]),
    ).toBeNull()
    expect(
      readStudioCinemaPlayableMedia([
        { kind: 'file', path: 'scenes/relative.mp4', mimeType: 'video/mp4' },
        { kind: 'file', path: 'https://media.invalid/out.webm', mimeType: 'video/webm' },
      ])?.url,
    ).toBe('https://media.invalid/out.webm')
    expect(readStudioCinemaPlayableMedia(undefined)).toBeNull()
  })

  it('offers submit only for a ready Scene without an active Run or a pending reconciliation', () => {
    const base = openState([
      createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0),
      createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, 1),
    ])
    expect(readStudioCinemaSceneEligibility(sceneRecordOf(base, CINEMA_TEST_SCENE_A)).submitBlockReason).toBe('loading')

    const ready = studioCinemaReducer(base, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: {
        scene: createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0),
        messages: [],
        runs: [],
        renders: [],
      },
    })
    expect(readStudioCinemaSceneEligibility(sceneRecordOf(ready, CINEMA_TEST_SCENE_A)).submitBlockReason).toBe(
      'empty_draft',
    )

    const drafted = applyActions(ready, [{ type: 'draft/changed', identity: IDENTITY_A, text: 'draw' }])
    expect(readStudioCinemaSceneEligibility(sceneRecordOf(drafted, CINEMA_TEST_SCENE_A)).canSubmit).toBe(true)

    const running = applyActions(drafted, [
      { type: 'submit/started', identity: IDENTITY_A },
      {
        type: 'submit/accepted',
        identity: IDENTITY_A,
        response: {
          scene: createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0),
          messages: [],
          runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running')],
          renders: [],
          run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running'),
        },
      },
      { type: 'draft/changed', identity: IDENTITY_A, text: 'draw again' },
    ])
    const runningEligibility = readStudioCinemaSceneEligibility(sceneRecordOf(running, CINEMA_TEST_SCENE_A))
    expect(runningEligibility.submitBlockReason).toBe('active_run')
    expect(runningEligibility.canCancel).toBe(true)

    // A cancel in flight hides the cancel action without making the Run disappear.
    const cancelling = applyActions(running, [{ type: 'cancel/started', identity: IDENTITY_A }])
    expect(readStudioCinemaSceneEligibility(sceneRecordOf(cancelling, CINEMA_TEST_SCENE_A)).canCancel).toBe(false)

    const unknown = applyActions(drafted, [
      { type: 'submit/started', identity: IDENTITY_A },
      { type: 'submit/failed', identity: IDENTITY_A, code: 'run_submit_unknown', unknownOutcome: true },
    ])
    const unknownEligibility = readStudioCinemaSceneEligibility(sceneRecordOf(unknown, CINEMA_TEST_SCENE_A))
    expect(unknownEligibility.submitBlockReason).toBe('reconciliation')
    expect(unknownEligibility.canReconcile).toBe(true)

    // The sibling Scene is untouched by everything scene A went through.
    expect(sceneRecordOf(unknown, CINEMA_TEST_SCENE_B).draft).toBe('')
    expect(readStudioCinemaSceneEligibility(sceneRecordOf(unknown, CINEMA_TEST_SCENE_B)).canSubmit).toBe(false)
  })

  it('derives the view capability from the same rule the controller enforces', () => {
    const ready = studioCinemaReducer(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: {
        scene: createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0),
        messages: [],
        runs: [],
        renders: [],
      },
    })
    expect(selectStudioCinemaSceneView(ready, CINEMA_TEST_SCENE_A)?.canSubmit).toBe(false)

    const drafted = applyActions(ready, [{ type: 'draft/changed', identity: IDENTITY_A, text: 'draw' }])
    expect(selectStudioCinemaSceneView(drafted, CINEMA_TEST_SCENE_A)?.canSubmit).toBe(true)
    expect(selectStudioCinemaSceneView(drafted, CINEMA_TEST_SCENE_A)?.canCancel).toBe(false)
    expect(selectStudioCinemaSceneView(drafted, CINEMA_TEST_SCENE_A)?.canReconcile).toBe(false)
  })

  it('reports a stable user status code for loading, working, failed and recoverable scenes', () => {
    const base = openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const recordOf = (state: StudioCinemaState) => sceneRecordOf(state, CINEMA_TEST_SCENE_A)

    expect(selectStudioCinemaUserStatus(recordOf(base))).toEqual({ code: 'idle', kind: 'idle' })

    const loading = applyActions(base, [{ type: 'scene/loading', identity: IDENTITY_A }])
    expect(selectStudioCinemaUserStatus(recordOf(loading))).toEqual({ code: 'scene_loading', kind: 'working' })

    const running = applyActions(base, [
      {
        type: 'scene/event',
        identity: IDENTITY_A,
        receivedAt: 1,
        event: { kind: 'run-updated', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running') },
      },
    ])
    expect(selectStudioCinemaUserStatus(recordOf(running))).toEqual({ code: 'run_running', kind: 'working' })

    const failed = applyActions(base, [
      {
        type: 'scene/event',
        identity: IDENTITY_A,
        receivedAt: 1,
        event: { kind: 'run-updated', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'failed') },
      },
    ])
    expect(selectStudioCinemaUserStatus(recordOf(failed))).toEqual({ code: 'run_failed', kind: 'failed' })

    const recoverable = applyActions(base, [
      { type: 'scene/snapshot-failed', identity: IDENTITY_A, code: 'snapshot_failed' },
    ])
    expect(selectStudioCinemaUserStatus(recordOf(recoverable))).toEqual({
      code: 'snapshot_failed',
      kind: 'recoverable',
    })

    // A pending convergence is a transport fact, never a failed Run.
    const pending = applyActions(base, [
      { type: 'scene/convergence-pending', identity: IDENTITY_A, at: 7 },
    ])
    expect(selectStudioCinemaUserStatus(recordOf(pending))).toEqual({ code: 'stream_resync', kind: 'connection' })

    // A dropped connection is not an outcome: the Scene keeps its previous status.
    const disconnected = applyActions(running, [
      { type: 'scene/stream-state', identity: IDENTITY_A, state: 'disconnected', attempt: 3 },
    ])
    expect(selectStudioCinemaUserStatus(recordOf(disconnected))).toEqual({ code: 'run_running', kind: 'working' })
    expect(selectStudioCinemaSceneView(disconnected, CINEMA_TEST_SCENE_A)?.streamState).toBe('disconnected')
  })

  it('plays a validated same-origin media path and refuses every other server path', () => {
    const state = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      renderEvent(CINEMA_TEST_SCENE_A, 'render_video', {
        updatedAt: '2026-03-22T00:10:00.000Z',
        attachments: [{ kind: 'file', path: '/videos/job-1111.mp4', mimeType: 'video/mp4' }],
      }),
    ])

    const display = selectStudioCinemaDisplayRender(sceneRecordOf(state, CINEMA_TEST_SCENE_A))
    expect(display.playableUrl).toBe('/videos/job-1111.mp4')
    expect(display.mediaKind).toBe('video')
    expect(display.capabilityGap).toBe(false)
  })

  it('mirrors the backend media policy for same-origin paths, including the lying MIME', () => {
    const locator = { kind: 'file' as const, path: '/images/job-1111-0.png', mimeType: 'text/html' }
    // The directory/extension table is authoritative for a same-origin locator.
    expect(readStudioCinemaMediaLocator(locator)).toMatchObject({
      kind: 'image',
      url: '/images/job-1111-0.png',
    })

    for (const path of [
      '/videos/job-1111.MP4',
      '/videos/job-1111.mp3',
      '/videos/job-1111',
      '/videos/sub/job.mp4',
      '/videos//job.mp4',
      '/videos/',
      '/videos/job.mp4?download=1',
      '/videos/job.mp4#fragment',
      '/videos/%2e%2e/secret.mp4',
      '/videos/job.mp4%00.png',
      '/videos\\job.mp4',
      '/Videos/job.mp4',
      '/public/videos/job.mp4',
      '/etc/passwd',
      'scenes/scene_0001.py',
      'renders/plot-test/plot.png',
      'videos/job.mp4',
      'C:/videos/job.mp4',
      '//evil.example.com/job.mp4',
    ]) {
      expect(readStudioCinemaSameOriginMediaLocator(path)).toBeNull()
      expect(readStudioCinemaMediaLocator({ kind: 'file', path })).toBeNull()
    }

    // A padded locator is refused by the resolver. The display path normalizes whitespace before it
    // validates, which is defence in depth rather than a second rule: the server never emits a padded
    // locator, because `readStudioPublicMediaLocator` refuses one before it can reach the wire.
    expect(readStudioCinemaSameOriginMediaLocator('/videos/job.mp4 ')).toBeNull()
    expect(readStudioCinemaMediaLocator({ kind: 'file', path: '/videos/job.mp4 ' })?.url).toBe(
      '/videos/job.mp4',
    )

    expect(readStudioCinemaSameOriginMediaLocator('/videos/job-1111.mp4')).toEqual({
      url: '/videos/job-1111.mp4',
      kind: 'video',
    })
  })

  it('keeps a playable video visible when a newer same-origin result carries no playable media', () => {
    const state = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      renderEvent(CINEMA_TEST_SCENE_A, 'render_old', {
        updatedAt: '2026-03-22T00:10:00.000Z',
        attachments: [{ kind: 'file', path: '/videos/old.mp4', mimeType: 'video/mp4' }],
      }),
      renderEvent(CINEMA_TEST_SCENE_A, 'render_new', {
        updatedAt: '2026-03-22T00:20:00.000Z',
        attachments: [{ kind: 'file', path: 'renders/plot-test/new.mp4', mimeType: 'video/mp4' }],
      }),
    ])

    const display = selectStudioCinemaDisplayRender(sceneRecordOf(state, CINEMA_TEST_SCENE_A))
    expect(display.playableUrl).toBe('/videos/old.mp4')
    expect(display.newestSuccess?.id).toBe('render_new')
    expect(display.capabilityGap).toBe(false)
  })

  it('reports the loop state of the selected Scene and its active render', () => {
    const state = applyActions(openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]), [
      { type: 'scene/selected', generation: 1, sceneId: CINEMA_TEST_SCENE_A },
      renderEvent(CINEMA_TEST_SCENE_A, 'render_waiting', { status: 'queued' }),
    ])

    const view = selectStudioCinemaSceneView(state, CINEMA_TEST_SCENE_A)
    expect(view?.activeRender?.id).toBe('render_waiting')
    expect(view?.renderRefresh).toEqual({ status: 'idle', pauseReason: null, refreshes: 0, consecutiveFailures: 0 })
    expect(readStudioCinemaActiveRender(sceneRecordOf(state, CINEMA_TEST_SCENE_A))?.status).toBe('queued')

    const paused = studioCinemaReducer(state, {
      type: 'scene/render-refresh',
      identity: IDENTITY_A,
      patch: { status: 'paused', pauseReason: 'budget', refreshes: 60 },
    })
    expect(selectStudioCinemaSceneView(paused, CINEMA_TEST_SCENE_A)?.renderRefresh).toEqual({
      status: 'paused',
      pauseReason: 'budget',
      refreshes: 60,
      consecutiveFailures: 0,
    })
    // A finished render means there is nothing to watch, whatever the loop bookkeeping says.
    const finished = studioCinemaReducer(state, {
      type: 'scene/event',
      identity: IDENTITY_A,
      event: { kind: 'render-updated', render: createTestRender(CINEMA_TEST_SCENE_A, 'render_waiting', { status: 'completed' }) },
      receivedAt: 1,
    })
    expect(readStudioCinemaActiveRender(sceneRecordOf(finished, CINEMA_TEST_SCENE_A))).toBeNull()
  })
  it('binds the refresh wait target to the unfinished Manim renders of the scene', () => {
    const ready = studioCinemaReducer(
      openState([createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]),
      {
        type: 'scene/snapshot',
        identity: IDENTITY_A,
        snapshot: {
          scene: createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0),
          messages: [],
          runs: [],
          renders: [
            createTestRender(CINEMA_TEST_SCENE_A, 'render_running', { status: 'running' }),
            createTestRender(CINEMA_TEST_SCENE_A, 'render_done', { status: 'completed' }),
            createTestRender(CINEMA_TEST_SCENE_A, 'render_queued', { status: 'queued' }),
          ],
        },
      },
    )

    // Only the unfinished Manim renders are waited for, sorted so the target is deterministic.
    expect(readStudioCinemaActiveRenderIds(sceneRecordOf(ready, CINEMA_TEST_SCENE_A))).toEqual([
      'render_queued',
      'render_running',
    ])
    expect(readStudioCinemaRenderWaitTarget(sceneRecordOf(ready, CINEMA_TEST_SCENE_A))).toBe(
      'render_queued,render_running',
    )

    // A status change of the same render is not a new wait, so a cycle keeps its budget across it.
    const advanced = studioCinemaReducer(ready, {
      type: 'scene/event',
      identity: IDENTITY_A,
      event: {
        kind: 'render-updated',
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_queued', { status: 'running' }),
      },
      receivedAt: 2,
    })
    expect(readStudioCinemaRenderWaitTarget(sceneRecordOf(advanced, CINEMA_TEST_SCENE_A))).toBe(
      'render_queued,render_running',
    )

    // Fixture correction 11C5-H3: the third step only finished `render_running`, so `render_queued`
    // (running since the step above) was still an unfinished wait. The finished one leaves the target,
    // and the target only becomes empty once the last unfinished render is finished too.
    const finished = studioCinemaReducer(advanced, {
      type: 'scene/event',
      identity: IDENTITY_A,
      event: {
        kind: 'render-updated',
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_running', { status: 'failed' }),
      },
      receivedAt: 3,
    })
    expect(readStudioCinemaRenderWaitTarget(sceneRecordOf(finished, CINEMA_TEST_SCENE_A))).toBe('render_queued')

    const allFinished = studioCinemaReducer(finished, {
      type: 'scene/event',
      identity: IDENTITY_A,
      event: {
        kind: 'render-updated',
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_queued', { status: 'completed' }),
      },
      receivedAt: 4,
    })
    expect(readStudioCinemaRenderWaitTarget(sceneRecordOf(allFinished, CINEMA_TEST_SCENE_A))).toBe('')
  })

  it('sums every Run tokenUsage into a Scene-scoped cumulative total, not just the latest Run', () => {
    const run = (id: string, usage: StudioTokenUsage | null): StudioSceneRun => ({
      id,
      sessionId: CINEMA_TEST_SESSION_ID,
      sceneId: CINEMA_TEST_SCENE_A,
      status: 'completed',
      inputText: '',
      activeAgent: 'builder',
      createdAt: '2026-03-22T00:00:00.000Z',
      completedAt: '2026-03-22T00:00:00.000Z',
      ...(usage ? { tokenUsage: usage } : {}),
    })
    const scene = {
      runs: [
        run('run_1', { promptTokens: 100, completionTokens: 200, totalTokens: 300, measuredCalls: 1, unmeasuredCalls: 0 }),
        run('run_2', null),
        run('run_3', { promptTokens: 50, completionTokens: 70, totalTokens: 120, measuredCalls: 1, unmeasuredCalls: 2 }),
      ],
    } as unknown as Parameters<typeof selectStudioCinemaSceneCumulativeTokenUsage>[0]

    expect(selectStudioCinemaSceneCumulativeTokenUsage(scene)).toEqual({
      promptTokens: 150,
      completionTokens: 270,
      totalTokens: 420,
      measuredCalls: 2,
      unmeasuredCalls: 2,
    })
  })

  it('returns null when no Run carried usage, so the card shows the unmeasured hint instead of zero', () => {
    const scene = {
      runs: [
        { id: 'run_1', sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A, status: 'completed', inputText: '', activeAgent: 'builder', createdAt: '2026-03-22T00:00:00.000Z', completedAt: '2026-03-22T00:00:00.000Z' },
      ],
    } as unknown as Parameters<typeof selectStudioCinemaSceneCumulativeTokenUsage>[0]
    expect(selectStudioCinemaSceneCumulativeTokenUsage(scene)).toBeNull()
  })
})
