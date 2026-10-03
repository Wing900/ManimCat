import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  InMemoryStudioEventBus,
  InMemoryStudioRenderStore,
  canTransitionStudioRenderStatus,
  createInMemoryStudioPersistence,
  createLocalStudioWorkspaceProvider,
  createStudioRender,
  createStudioRenderResultReconciler,
  createStudioRun,
  createStudioRuntimeService,
  createStudioScene,
  createStudioSession,
  isStudioPublicMediaLocator,
  isStudioRenderTerminalStatus,
  readPublicRenderAttachments,
  readStudioPublicMediaLocator,
  readStudioRenderReconcileOrder,
  readStudioRenderReconcileWindow,
  readStudioRenderResultTransition,
  createStudioRenderReconcileCursor,
  buildStudioRenderReconcileScopeKey,
  STUDIO_RENDER_MEDIA_GAP_METADATA_KEY,
  STUDIO_RENDER_RECONCILE_MAX_PER_READ,
  STUDIO_RENDER_RESULT_ERROR_MAX_LENGTH,
  type StudioAgentEvent,
  type StudioPersistence,
  type StudioRender,
  type StudioRenderResult,
  type StudioRenderResultPort,
  type StudioRenderStore,
  type StudioScene,
  type StudioSession
} from '../../index'
import { toPublicStudioSceneAttachment, toPublicStudioSceneSnapshot } from '../../http/public-dto'
import { createWorkspace, run } from './factories'

/**
 * Render result bridge specs (task 11C1M).
 *
 * The bridge is the only place that turns a Manim job result into a Studio render state, so these
 * specs cover four layers: the pure media locator, the pure (render, result) to write mapping, the
 * reconciler against a real in-memory render store with a fake result port, and the Scene read model
 * that triggers it. No Redis, no Bull, no queue processor and no HTTP server is started: the job
 * store adapter is asserted by source text, which is also why importing it is never needed here.
 */

const OWNER = 'owner-render-bridge'
const FOREIGN_OWNER = 'owner-render-bridge-other'
const JOB_ID = 'job-1111'

interface RecordingResultPort {
  port: StudioRenderResultPort
  calls: string[]
}

function createRecordingResultPort(results: Record<string, StudioRenderResult>): RecordingResultPort {
  const calls: string[] = []
  return {
    calls,
    port: {
      async getRenderResult(jobId: string): Promise<StudioRenderResult> {
        calls.push(jobId)
        return results[jobId] ?? { status: 'unknown' }
      }
    }
  }
}

function createThrowingResultPort(): StudioRenderResultPort {
  return {
    async getRenderResult(): Promise<StudioRenderResult> {
      throw new Error('job store unavailable')
    }
  }
}

interface ReconcilerFixture {
  reconciler: ReturnType<typeof createStudioRenderResultReconciler>
  renderStore: InMemoryStudioRenderStore
  eventBus: InMemoryStudioEventBus
  calls: string[]
}

function createReconcilerFixture(results: Record<string, StudioRenderResult>): ReconcilerFixture {
  const renderStore = new InMemoryStudioRenderStore()
  const eventBus = new InMemoryStudioEventBus()
  const recording = createRecordingResultPort(results)

  return {
    reconciler: createStudioRenderResultReconciler({
      resultPort: recording.port,
      renderStore,
      eventBus
    }),
    renderStore,
    eventBus,
    calls: recording.calls
  }
}

/** Collects the `render_updated` events one reconciler publishes. */
function subscribeRenderEvents(eventBus: InMemoryStudioEventBus, sessionId: string): StudioAgentEvent[] {
  const events: StudioAgentEvent[] = []
  eventBus.subscribe(sessionId, (event) => {
    events.push(event)
  })
  return events
}

function sceneRender(input?: {
  sceneId?: string
  status?: StudioRender['status']
  jobId?: string | undefined
  kind?: StudioRender['kind']
  ownerId?: string
  sessionId?: string
  attachments?: StudioRender['attachments']
  metadata?: Record<string, unknown>
  createdAt?: string
}): StudioRender {
  const render = createStudioRender({
    ownerId: input?.ownerId ?? OWNER,
    sessionId: input?.sessionId ?? 'session-render-bridge',
    ...(input?.sceneId === undefined ? {} : { sceneId: input.sceneId }),
    kind: input?.kind ?? 'manim',
    title: 'Render',
    concept: 'a circle',
    outputMode: 'video',
    status: input?.status ?? 'queued',
    ...(input?.jobId === undefined ? {} : { jobId: input.jobId }),
    ...(input?.attachments ? { attachments: input.attachments } : {}),
    ...(input?.metadata ? { metadata: input.metadata } : {})
  })
  return {
    ...render,
    ...(input?.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {})
  }
}

function readRepoSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

export async function runRenderResultBridgeTests(): Promise<void> {
  await run('media locator accepts only the verified same-origin media paths, data and http', async () => {
    for (const locator of [
      '/videos/job-1111.mp4',
      '/images/job-1111-0.png',
      '/images/a.b-c_d-1.png',
      'data:image/png;base64,AAAA',
      'data:video/mp4;base64,AAAA',
      'https://cdn.example.com/out.mp4',
      'http://cdn.example.com/out.png?cache=1',
      'https://cdn.example.com/render/out.mp4#t=1'
    ]) {
      assert.ok(isStudioPublicMediaLocator(locator), `expected a public locator: ${locator}`)
    }

    for (const rejected of [
      '',
      ' ',
      '/videos/job-1111.mp4 ',
      ' /videos/job-1111.mp4',
      '/videos/job-1111.MP4',
      '/videos/job-1111.mp3',
      '/videos/job-1111',
      '/videos/.mp4',
      '/videos/..mp4',
      '/videos/a..b.mp4',
      '/videos/sub/a.mp4',
      '/videos//a.mp4',
      '/videos/',
      '/videos/a.mp4/',
      '/videos/a.mp4?download=1',
      '/videos/a.mp4#fragment',
      '/videos/a.mp4%00.png',
      '/videos/%2e%2e/secret.mp4',
      '/Videos/a.mp4',
      '/public/videos/a.mp4',
      '/videos\\a.mp4',
      '/etc/passwd',
      '/videos/a.exe',
      'scenes/scene_0001.py',
      'renders/plot-test/plot.png',
      'videos/a.mp4',
      'C:/videos/a.mp4',
      'C:\\videos\\a.mp4',
      '\\\\server\\share\\a.mp4',
      '//evil.example.com/a.mp4',
      'data:text/plain;base64,AAAA',
      'data:image/png;base64,',
      'data:image/png',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'D:/private/out.mp4'
    ]) {
      assert.equal(isStudioPublicMediaLocator(rejected), false, `expected a refusal: ${rejected}`)
    }

    // The data URI payload bound is a payload bound, not the URL bound.
    const largeDataUri = `data:image/png;base64,${'A'.repeat(3000)}`
    assert.ok(isStudioPublicMediaLocator(largeDataUri))
    assert.equal(readStudioPublicMediaLocator(`/videos/${'a'.repeat(3000)}.mp4`), null)
  })

  await run('media locator states the media type only when the locator itself proves it', async () => {
    assert.deepEqual(readStudioPublicMediaLocator('/videos/a.mp4'), {
      locator: '/videos/a.mp4',
      kind: 'same-origin',
      mediaKind: 'video',
      mimeType: 'video/mp4'
    })
    assert.deepEqual(readStudioPublicMediaLocator('/images/a-0.png'), {
      locator: '/images/a-0.png',
      kind: 'same-origin',
      mediaKind: 'image',
      mimeType: 'image/png'
    })
    assert.deepEqual(readStudioPublicMediaLocator('data:image/png;base64,AAAA'), {
      locator: 'data:image/png;base64,AAAA',
      kind: 'data',
      mediaKind: 'image',
      mimeType: 'image/png'
    })
    // An http URL without a media extension carries no media claim.
    assert.deepEqual(readStudioPublicMediaLocator('https://cdn.example.com/download'), {
      locator: 'https://cdn.example.com/download',
      kind: 'http'
    })
  })

  await run('render status transitions only move forward', async () => {
    assert.equal(canTransitionStudioRenderStatus(['queued'], 'running'), true)
    assert.equal(canTransitionStudioRenderStatus(['queued'], 'completed'), true)
    assert.equal(canTransitionStudioRenderStatus(['running'], 'failed'), true)
    assert.equal(canTransitionStudioRenderStatus(['running'], 'cancelled'), true)
    assert.equal(canTransitionStudioRenderStatus([], 'running'), false)
    assert.equal(canTransitionStudioRenderStatus(['running'], 'queued'), false)
    assert.equal(canTransitionStudioRenderStatus(['completed'], 'running'), false)
    assert.equal(canTransitionStudioRenderStatus(['failed'], 'completed'), false)
    assert.equal(canTransitionStudioRenderStatus(['cancelled'], 'completed'), false)
    assert.equal(isStudioRenderTerminalStatus('cancelled'), true)
    assert.equal(isStudioRenderTerminalStatus('queued'), false)
  })

  await run('the result mapping never writes an unknown, an unchanged or a terminal render', async () => {
    const queued = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    const running = sceneRender({ sceneId: 'scene-1', status: 'running', jobId: JOB_ID })
    const completed = sceneRender({ sceneId: 'scene-1', status: 'completed', jobId: JOB_ID })

    assert.equal(readStudioRenderResultTransition(queued, { status: 'unknown' }), null)
    assert.equal(readStudioRenderResultTransition(completed, { status: 'running' }), null)
    assert.equal(readStudioRenderResultTransition(completed, { status: 'completed' }), null)
    assert.equal(readStudioRenderResultTransition(completed, { status: 'failed' }), null)
    assert.equal(readStudioRenderResultTransition(queued, { status: 'queued' }), null)
    assert.equal(readStudioRenderResultTransition(running, { status: 'running' }), null)

    assert.deepEqual(readStudioRenderResultTransition(queued, { status: 'running' }), {
      from: ['queued'],
      patch: { status: 'running' }
    })
    assert.deepEqual(readStudioRenderResultTransition(running, { status: 'failed', error: 'boom' }), {
      from: ['running'],
      patch: { status: 'failed', error: 'boom' }
    })
    assert.deepEqual(readStudioRenderResultTransition(running, { status: 'cancelled' }), {
      from: ['running'],
      patch: { status: 'cancelled' }
    })

    // Completed with public media.
    const withMedia = readStudioRenderResultTransition(running, {
      status: 'completed',
      media: [{ locator: '/videos/a.mp4', mimeType: 'video/mp4' }]
    })
    assert.deepEqual(withMedia, {
      from: ['running'],
      patch: {
        status: 'completed',
        attachments: [{ kind: 'file', path: '/videos/a.mp4', mimeType: 'video/mp4' }]
      }
    })

    // Completed without usable public media: completed, internally marked, never a fake URL.
    const withoutMedia = readStudioRenderResultTransition(running, { status: 'completed', media: [] })
    assert.equal(withoutMedia?.patch.status, 'completed')
    assert.equal('attachments' in (withoutMedia?.patch ?? {}), false)
    assert.equal(
      withoutMedia?.patch.metadata?.[STUDIO_RENDER_MEDIA_GAP_METADATA_KEY],
      'missing_public_media'
    )
  })

  await run('the reconciler writes a real job state and publishes only after it persisted', async () => {
    const fixture = createReconcilerFixture({
      [JOB_ID]: {
        status: 'completed',
        media: [
          { locator: '/videos/job-1111.mp4', mimeType: 'video/mp4' },
          { locator: '/images/job-1111-0.png', mimeType: 'image/png' }
        ]
      }
    })
    const published = subscribeRenderEvents(fixture.eventBus, 'session-render-bridge')

    const render = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    await fixture.renderStore.create(render)

    const effective = await fixture.reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })

    const stored = await fixture.renderStore.getById(OWNER, render.id)
    assert.equal(stored?.status, 'completed')
    assert.deepEqual(stored?.attachments, [
      { kind: 'file', path: '/videos/job-1111.mp4', mimeType: 'video/mp4' },
      { kind: 'file', path: '/images/job-1111-0.png', mimeType: 'image/png' }
    ])
    assert.equal(effective[0]?.status, 'completed')
    assert.deepEqual(effective[0]?.attachments, stored?.attachments)
    assert.equal(published.length, 1)
    assert.equal(published[0]?.type, 'render_updated')
    // The published record is the persisted one, not the pre-write copy.
    assert.equal(
      published[0]?.type === 'render_updated' ? published[0].render.status : null,
      'completed'
    )
  })

  await run('a completed job without public media completes the render and records the gap', async () => {
    const resultPort = createRecordingResultPort({
      [JOB_ID]: { status: 'completed', media: [] }
    })
    const renderStore = new InMemoryStudioRenderStore()
    const eventBus = new InMemoryStudioEventBus()
    const published = subscribeRenderEvents(eventBus, 'session-render-bridge')
    const reconciler = createStudioRenderResultReconciler({
      resultPort: resultPort.port,
      renderStore,
      eventBus
    })
    const render = sceneRender({ sceneId: 'scene-1', status: 'running', jobId: JOB_ID })
    await renderStore.create(render)

    const effective = await reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })

    const stored = await renderStore.getById(OWNER, render.id)
    assert.equal(stored?.status, 'completed')
    assert.equal(stored?.attachments, undefined)
    assert.equal(stored?.metadata?.[STUDIO_RENDER_MEDIA_GAP_METADATA_KEY], 'missing_public_media')
    assert.equal(effective[0]?.metadata?.[STUDIO_RENDER_MEDIA_GAP_METADATA_KEY], 'missing_public_media')
    assert.equal(published.length, 1)

    // A public projection of that render keeps the completed status and carries no attachment.
    const attachment = toPublicStudioSceneAttachment({
      kind: 'file',
      path: 'renders/plot-test/out.mp4'
    })
    assert.equal(attachment, undefined)
  })

  await run('unknown, missing and throwing result sources never change a render', async () => {
    const renderStore = new InMemoryStudioRenderStore()
    const eventBus = new InMemoryStudioEventBus()
    const published = subscribeRenderEvents(eventBus, 'session-render-bridge')

    const unknownPort = createRecordingResultPort({})
    const unknownReconciler = createStudioRenderResultReconciler({
      resultPort: unknownPort.port,
      renderStore,
      eventBus
    })
    const render = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    await renderStore.create(render)

    const effective = await unknownReconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })

    assert.deepEqual(unknownPort.calls, [JOB_ID])
    assert.equal((await renderStore.getById(OWNER, render.id))?.status, 'queued')
    assert.equal(effective[0]?.status, 'queued')
    assert.equal(published.length, 0)

    const throwingReconciler = createStudioRenderResultReconciler({
      resultPort: createThrowingResultPort(),
      renderStore,
      eventBus
    })
    const afterThrow = await throwingReconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })
    assert.equal(afterThrow[0]?.status, 'queued')
    assert.equal((await renderStore.getById(OWNER, render.id))?.status, 'queued')
    assert.equal(published.length, 0)
  })

  await run('the reconciler is scoped to its owner, Session, Scene and kind', async () => {
    const resultPort = createRecordingResultPort({
      [JOB_ID]: { status: 'completed', media: [{ locator: '/videos/job-1111.mp4' }] }
    })
    const renderStore = new InMemoryStudioRenderStore()
    const eventBus = new InMemoryStudioEventBus()
    const published = subscribeRenderEvents(eventBus, 'session-render-bridge')
    const reconciler = createStudioRenderResultReconciler({
      resultPort: resultPort.port,
      renderStore,
      eventBus
    })

    const mine = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    const otherScene = sceneRender({ sceneId: 'scene-2', status: 'queued', jobId: JOB_ID })
    const otherOwner = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID, ownerId: FOREIGN_OWNER })
    const legacy = sceneRender({ status: 'queued', jobId: JOB_ID })
    const plot = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID, kind: 'plot' })
    const withoutJob = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: undefined })
    const finished = sceneRender({ sceneId: 'scene-1', status: 'completed', jobId: JOB_ID })

    for (const render of [mine, otherScene, otherOwner, legacy, plot, withoutJob, finished]) {
      await renderStore.create(render)
    }

    const effective = await reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: mine.sessionId,
      sceneId: 'scene-1',
      renders: [mine, otherScene, otherOwner, legacy, plot, withoutJob, finished]
    })

    // Exactly one job was ever asked about, and only the in-scope render moved.
    assert.deepEqual(resultPort.calls, [JOB_ID])
    assert.equal(effective[0]?.status, 'completed')
    assert.equal((await renderStore.getById(OWNER, otherScene.id))?.status, 'queued')
    assert.equal((await renderStore.getById(FOREIGN_OWNER, otherOwner.id))?.status, 'queued')
    assert.equal((await renderStore.getById(OWNER, legacy.id))?.status, 'queued')
    assert.equal((await renderStore.getById(OWNER, plot.id))?.status, 'queued')
    assert.equal((await renderStore.getById(OWNER, withoutJob.id))?.status, 'queued')
    assert.equal((await renderStore.getById(OWNER, finished.id))?.status, 'completed')
    assert.equal(published.length, 1)
  })

  await run('a repeated reconciliation is idempotent and a lost race publishes nothing', async () => {
    const resultPort = createRecordingResultPort({
      [JOB_ID]: { status: 'running' }
    })
    const renderStore = new InMemoryStudioRenderStore()
    const eventBus = new InMemoryStudioEventBus()
    const published = subscribeRenderEvents(eventBus, 'session-render-bridge')
    const reconciler = createStudioRenderResultReconciler({
      resultPort: resultPort.port,
      renderStore,
      eventBus
    })
    const render = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    await renderStore.create(render)

    const first = await reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })
    assert.equal(first[0]?.status, 'running')
    assert.equal(published.length, 1)

    // Same observation again: the status already matches, so nothing is written or published.
    const second = await reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: first
    })
    assert.equal(second[0]?.status, 'running')
    assert.equal(published.length, 1)

    // A conditional write that loses the race reports the stored winner instead of the local copy.
    const stale = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    await renderStore.create(stale)
    const completedWinner = await renderStore.transitionStatus({
      ownerId: OWNER,
      renderId: stale.id,
      from: ['queued'],
      expectedJobId: JOB_ID,
      patch: { status: 'completed', attachments: [{ kind: 'file', path: '/videos/winner.mp4' }] }
    })
    assert.equal(completedWinner.applied, true)

    const lostRace = await reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      // A stale read: this copy still says `queued` while the store already says `completed`.
      renders: [{ ...stale, status: 'queued' }]
    })
    assert.equal(lostRace[0]?.status, 'completed')
    assert.equal((await renderStore.getById(OWNER, stale.id))?.status, 'completed')
    assert.equal(published.length, 1)
  })

  await run('one reconciliation asks about at most the configured number of renders', async () => {
    const resultPort = createRecordingResultPort({})
    const renderStore = new InMemoryStudioRenderStore()
    const reconciler = createStudioRenderResultReconciler({
      resultPort: resultPort.port,
      renderStore,
      eventBus: new InMemoryStudioEventBus()
    })

    const renders = Array.from({ length: STUDIO_RENDER_RECONCILE_MAX_PER_READ + 3 }, (_, index) =>
      sceneRender({
        sceneId: 'scene-1',
        status: 'queued',
        jobId: `job-${index}`,
        createdAt: `2026-03-22T00:00:0${index}.000Z`
      })
    )
    for (const render of renders) {
      await renderStore.create(render)
    }

    await reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: renders[0]?.sessionId ?? '',
      sceneId: 'scene-1',
      renders
    })

    assert.equal(resultPort.calls.length, STUDIO_RENDER_RECONCILE_MAX_PER_READ)
  })

  await run('the Scene read model completes a render from the job store on its own', async () => {
    const persistence = createInMemoryStudioPersistence()
    const resultPort = createRecordingResultPort({
      [JOB_ID]: { status: 'completed', media: [{ locator: '/videos/job-1111.mp4', mimeType: 'video/mp4' }] }
    })
    const runtime = createStudioRuntimeService({
      persistence,
      workspaceProvider: createLocalStudioWorkspaceProvider(),
      renderResultPort: resultPort.port
    })
    const session = createStudioSession({
      ownerId: OWNER,
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Render bridge',
      directory: await createWorkspace()
    })
    await persistence.sessionStore.create(session)
    const created = await runtime.createScene({ ownerId: OWNER, sessionId: session.id })
    assert.equal(created.status, 'created')
    const scene = created.status === 'created' ? created.scene : ({} as StudioScene)

    // A Run that already finished must not stop render recovery: the render is still queued.
    const finishedRun = createStudioRun({
      ownerId: OWNER,
      sessionId: session.id,
      sceneId: scene.id,
      inputText: 'draw a circle',
      activeAgent: 'builder'
    })
    await persistence.runStore.create({ ...finishedRun, status: 'completed' })
    const render = sceneRender({
      sceneId: scene.id,
      sessionId: session.id,
      status: 'queued',
      jobId: JOB_ID
    })
    await persistence.renderStore.create(render)

    const snapshot = await runtime.getSceneSnapshot(OWNER, session.id, scene.id)
    assert.ok(snapshot)
    const bridged = snapshot?.renders.find((entry) => entry.id === render.id)
    assert.equal(bridged?.status, 'completed')
    assert.deepEqual(bridged?.attachments, [
      { kind: 'file', path: '/videos/job-1111.mp4', mimeType: 'video/mp4' }
    ])
    // The public Scene projection keeps the same-origin locator and states its media type.
    const publicSnapshot = toPublicStudioSceneSnapshot(snapshot!)
    assert.deepEqual(publicSnapshot.renders[0]?.attachments, [
      { kind: 'file', path: '/videos/job-1111.mp4', mimeType: 'video/mp4' }
    ])
    assert.equal(JSON.stringify(publicSnapshot).includes('mediaGap'), false)
  })

  await run('a failing result source leaves the Scene read model readable', async () => {
    const persistence = createInMemoryStudioPersistence()
    const runtime = createStudioRuntimeService({
      persistence,
      workspaceProvider: createLocalStudioWorkspaceProvider(),
      renderResultPort: createThrowingResultPort()
    })
    const session = createStudioSession({
      ownerId: OWNER,
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Render bridge failure',
      directory: await createWorkspace()
    })
    await persistence.sessionStore.create(session)
    const created = await runtime.createScene({ ownerId: OWNER, sessionId: session.id })
    const scene = created.status === 'created' ? created.scene : ({} as StudioScene)
    const render = sceneRender({
      sceneId: scene.id,
      sessionId: session.id,
      status: 'running',
      jobId: JOB_ID
    })
    await persistence.renderStore.create(render)

    const snapshot = await runtime.getSceneSnapshot(OWNER, session.id, scene.id)
    assert.equal(snapshot?.renders[0]?.status, 'running')
    assert.equal(snapshot?.renders[0]?.error, undefined)
  })

  await run('a runtime without a job store never touches the queue', async () => {
    const persistence = createInMemoryStudioPersistence()
    const runtime = createStudioRuntimeService({
      persistence,
      workspaceProvider: createLocalStudioWorkspaceProvider()
    })
    const session = createStudioSession({
      ownerId: OWNER,
      projectId: 'project-1',
      agentType: 'builder',
      title: 'No job store',
      directory: await createWorkspace()
    })
    await persistence.sessionStore.create(session)
    const created = await runtime.createScene({ ownerId: OWNER, sessionId: session.id })
    const scene = created.status === 'created' ? created.scene : ({} as StudioScene)
    const render = sceneRender({
      sceneId: scene.id,
      sessionId: session.id,
      status: 'queued',
      jobId: JOB_ID
    })
    await persistence.renderStore.create(render)

    const snapshot = await runtime.getSceneSnapshot(OWNER, session.id, scene.id)
    // The default port answers `unknown`, so the stored record is returned unchanged.
    assert.equal(snapshot?.renders[0]?.status, 'queued')
  })

  await run('the Scene DTO refuses every locator that is not public media', async () => {
    const accepted = toPublicStudioSceneAttachment({ kind: 'file', path: '/videos/a.mp4' })
    assert.deepEqual(accepted, { kind: 'file', path: '/videos/a.mp4', mimeType: 'video/mp4' })

    // A mismatched claim cannot travel with a same-origin locator: the table decides.
    assert.deepEqual(toPublicStudioSceneAttachment({ kind: 'file', path: '/images/a.png', mimeType: 'text/html' }), {
      kind: 'file',
      path: '/images/a.png',
      mimeType: 'image/png'
    })
    // A data URI and an http URL keep the media type they declared.
    assert.deepEqual(
      toPublicStudioSceneAttachment({ kind: 'file', path: 'data:image/png;base64,AAAA', mimeType: 'image/png' }),
      { kind: 'file', path: 'data:image/png;base64,AAAA', mimeType: 'image/png' }
    )

    for (const path of [
      'renders/plot-test/out.mp4',
      'scenes/scene_0001.py',
      '/etc/passwd',
      'D:/private/out.mp4',
      '\\\\server\\share\\out.mp4',
      '/videos/../secret.mp4',
      '//evil.example.com/a.mp4'
    ]) {
      assert.equal(toPublicStudioSceneAttachment({ kind: 'file', path }), undefined, `expected no attachment: ${path}`)
    }
  })

  await run('the render result bridge reads the job store and never writes it', async () => {
    const adapter = readRepoSource('src', 'studio-agent', 'manim', 'job-store-render-result-port.ts')
    assert.match(adapter, /import \{ getBullJobStatus, getJobResult \} from '\.\.\/\.\.\/services\/job-store'/)
    assert.equal(/storeJobResult|deleteJobResult|setJobResult|videoQueue|redisClient/.test(adapter), false)
    // The adapter is not part of the barrel: importing the Studio barrel must not load Redis.
    const barrel = readRepoSource('src', 'studio-agent', 'index.ts')
    assert.equal(barrel.includes('job-store-render-result-port'), false)

    // The Scene read model asks the reconciler, never the job store directly.
    const sceneService = readRepoSource('src', 'studio-agent', 'scenes', 'studio-scene-service.ts')
    assert.equal(/services\/job-store|redis|bull/i.test(sceneService), false)
    assert.match(sceneService, /reconcileSceneRenders/)

    // The composition root is where the queue-aware adapter is injected.
    const composition = readRepoSource('src', 'studio-agent', 'runtime', 'runtime-service.ts')
    assert.match(composition, /renderResultPort: createJobStoreStudioRenderResultPort\(\)/)

    // One conditional write contract, expressed in the write itself, in both backends.
    const memory = readRepoSource('src', 'studio-agent', 'render', 'memory-render-store.ts')
    assert.match(memory, /canTransitionStudioRenderStatus/)
    assert.match(memory, /input\.expectedJobId/)
    const supabase = readRepoSource('src', 'studio-agent', 'persistence', 'supabase-studio-persistence.ts')
    const renderStoreBody = supabase.slice(supabase.indexOf('async transitionStatus(input)', supabase.indexOf('createSupabaseStudioRenderStore')))
    assert.match(renderStoreBody, /\.in\('status', \[\.\.\.input\.from\]\)/)
    assert.match(renderStoreBody, /\.eq\('job_id', input\.expectedJobId\)/)
  })

  await run('two concurrent reconciliations of one render produce one winner and one publish', async () => {
    const resultPort = createRecordingResultPort({
      [JOB_ID]: { status: 'completed', media: [{ locator: '/videos/job-1111.mp4', mimeType: 'video/mp4' }] }
    })
    const renderStore = new InMemoryStudioRenderStore()
    const eventBus = new InMemoryStudioEventBus()
    const published = subscribeRenderEvents(eventBus, 'session-render-bridge')

    // A store whose conditional write can be held open, so both readers are in flight together and
    // the real compare-and-set of the in-memory store decides the winner.
    const gateControl: { release?: () => void } = {}
    const gate = new Promise<void>((resolve) => {
      gateControl.release = resolve
    })
    let held = 0
    const gatedStore: StudioRenderStore = {
      create: (render) => renderStore.create(render),
      getById: (ownerId, renderId) => renderStore.getById(ownerId, renderId),
      update: (ownerId, renderId, patch) => renderStore.update(ownerId, renderId, patch),
      async transitionStatus(input) {
        held += 1
        if (held === 1) {
          await gate
        }
        return renderStore.transitionStatus(input)
      },
      listBySessionId: (ownerId, sessionId) => renderStore.listBySessionId(ownerId, sessionId),
      listBySceneId: (ownerId, sceneId) => renderStore.listBySceneId(ownerId, sceneId)
    }
    const reconciler = createStudioRenderResultReconciler({
      resultPort: resultPort.port,
      renderStore: gatedStore,
      eventBus
    })
    const render = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    await renderStore.create(render)

    const first = reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })
    const second = reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })
    await Promise.resolve()
    gateControl.release?.()

    const [firstEffective, secondEffective] = await Promise.all([first, second])
    const stored = await renderStore.getById(OWNER, render.id)
    assert.equal(stored?.status, 'completed')
    // Only one conditional write applied, so exactly one completion was published.
    assert.equal(published.length, 1)
    // Both callers read back the real winner, never a locally invented state.
    assert.equal(firstEffective[0]?.status, 'completed')
    assert.equal(secondEffective[0]?.status, 'completed')
    assert.deepEqual(firstEffective[0]?.attachments, stored?.attachments)
    assert.deepEqual(secondEffective[0]?.attachments, stored?.attachments)
  })

  await run('an illegal backward observation is refused before any write', async () => {
    const running = sceneRender({ sceneId: 'scene-1', status: 'running', jobId: JOB_ID })
    // Bull reporting `waiting` again (a retry) must not demote a running render to queued.
    assert.equal(readStudioRenderResultTransition(running, { status: 'queued' }), null)
    assert.equal(readStudioRenderResultTransition(running, { status: 'cancelled' })?.patch.status, 'cancelled')
  })

  await run('a legacy render without a Scene scope is never reconciled', async () => {
    const persistence: StudioPersistence = createInMemoryStudioPersistence()
    const resultPort = createRecordingResultPort({
      [JOB_ID]: { status: 'completed', media: [{ locator: '/videos/job-1111.mp4' }] }
    })
    const session: StudioSession = createStudioSession({
      ownerId: OWNER,
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Legacy renders',
      directory: await createWorkspace()
    })
    await persistence.sessionStore.create(session)
    const scene: StudioScene = {
      ...createStudioScene({ ownerId: OWNER, sessionId: session.id, position: 0, sourcePath: 'scenes/legacy.py' })
    }
    await persistence.sceneStore.create(scene)
    // A Session-scoped render (no Scene) must stay exactly as stored.
    await persistence.renderStore.create(
      sceneRender({ sessionId: session.id, status: 'queued', jobId: JOB_ID, sceneId: undefined })
    )

    const runtime = createStudioRuntimeService({
      persistence,
      workspaceProvider: createLocalStudioWorkspaceProvider(),
      renderResultPort: resultPort.port
    })
    const snapshot = await runtime.getSceneSnapshot(OWNER, session.id, scene.id)
    assert.deepEqual(snapshot?.renders, [])
    assert.deepEqual(resultPort.calls, [])
  })

  // ------------------------------------------------------------------ reconciliation fairness

  await run('a stuck prefix of unresolved renders never hides the render behind it', async () => {
    const renders = Array.from({ length: 9 }, (_, index) =>
      sceneRender({
        sceneId: 'scene-1',
        status: 'queued',
        jobId: `job-${index}`,
        createdAt: `2026-03-22T00:00:0${index}.000Z`
      })
    )
    const results: Record<string, StudioRenderResult> = {}
    for (let index = 0; index < 8; index += 1) {
      results[`job-${index}`] = { status: 'unknown' }
    }
    results['job-8'] = {
      status: 'completed',
      media: [{ locator: '/videos/job-8.mp4', mimeType: 'video/mp4' }]
    }

    const fixture = createReconcilerFixture(results)
    for (const render of renders) {
      await fixture.renderStore.create(render)
    }
    const input = {
      ownerId: OWNER,
      sessionId: renders[0]?.sessionId ?? '',
      sceneId: 'scene-1',
      renders
    }

    // The first read spends its whole bound on the stuck prefix: the ninth render is not asked yet,
    // and it is not lost either, it simply keeps waiting.
    const first = await fixture.reconciler.reconcileSceneRenders(input)
    assert.equal(fixture.calls.length, STUDIO_RENDER_RECONCILE_MAX_PER_READ)
    assert.equal(fixture.calls.includes('job-8'), false)
    assert.equal(first.find((render) => render.jobId === 'job-8')?.status, 'queued')

    // The next read of the very same Scene continues after where the first stopped.
    const second = await fixture.reconciler.reconcileSceneRenders(input)
    assert.equal(fixture.calls.includes('job-8'), true)
    const completed = second.find((render) => render.jobId === 'job-8')
    assert.equal(completed?.status, 'completed')
    assert.equal(completed?.attachments?.[0]?.path, '/videos/job-8.mp4')

    // An unresolved job result stays unknown: it is never rewritten as failed to free a slot.
    for (let index = 0; index < 8; index += 1) {
      assert.equal(second.find((render) => render.jobId === `job-${index}`)?.status, 'queued')
    }
  })

  await run('every candidate of a stable backlog is examined within a bounded number of reads', async () => {
    const count = 17
    const renders = Array.from({ length: count }, (_, index) =>
      sceneRender({
        sceneId: 'scene-1',
        status: 'queued',
        jobId: `job-${index}`,
        createdAt: `2026-03-22T00:00:${String(index).padStart(2, '0')}.000Z`
      })
    )
    const results: Record<string, StudioRenderResult> = {}
    for (let index = 0; index < count; index += 1) {
      results[`job-${index}`] = {
        status: 'completed',
        media: [{ locator: `/videos/job-${index}.mp4`, mimeType: 'video/mp4' }]
      }
    }

    const fixture = createReconcilerFixture(results)
    for (const render of renders) {
      await fixture.renderStore.create(render)
    }

    const rounds = Math.ceil(count / STUDIO_RENDER_RECONCILE_MAX_PER_READ)
    let effective = renders
    for (let round = 0; round < rounds; round += 1) {
      effective = await fixture.reconciler.reconcileSceneRenders({
        ownerId: OWNER,
        sessionId: renders[0]?.sessionId ?? '',
        sceneId: 'scene-1',
        renders: effective
      })
    }

    // 24 slots over 17 candidates in 3 reads: no candidate was skipped and none was asked twice.
    assert.equal(new Set(fixture.calls).size, count)
    assert.equal(fixture.calls.length, count)
    for (const render of effective) {
      assert.equal(render.status, 'completed')
    }
  })

  await run('the reconcile window rotates, wraps and restarts without an anchor', async () => {
    const renders = Array.from({ length: 9 }, (_, index) =>
      sceneRender({
        sceneId: 'scene-1',
        jobId: `job-${index}`,
        createdAt: `2026-03-22T00:00:0${index}.000Z`
      })
    )
    const ordered = readStudioRenderReconcileOrder(renders)
    assert.deepEqual(
      ordered.map((render) => render.jobId),
      ['job-0', 'job-1', 'job-2', 'job-3', 'job-4', 'job-5', 'job-6', 'job-7', 'job-8']
    )

    const first = readStudioRenderReconcileWindow(ordered, null, STUDIO_RENDER_RECONCILE_MAX_PER_READ)
    assert.deepEqual(
      first.window.map((render) => render.jobId),
      ['job-0', 'job-1', 'job-2', 'job-3', 'job-4', 'job-5', 'job-6', 'job-7']
    )
    assert.equal(first.anchor, ordered[7]?.id)

    const second = readStudioRenderReconcileWindow(
      ordered,
      first.anchor,
      STUDIO_RENDER_RECONCILE_MAX_PER_READ
    )
    assert.deepEqual(
      second.window.map((render) => render.jobId),
      ['job-8', 'job-0', 'job-1', 'job-2', 'job-3', 'job-4', 'job-5', 'job-6']
    )
    assert.equal(second.anchor, ordered[6]?.id)

    // An unknown anchor (the render it named is gone, or the process restarted) restarts at the oldest.
    const restarted = readStudioRenderReconcileWindow(
      ordered,
      'render_missing',
      STUDIO_RENDER_RECONCILE_MAX_PER_READ
    )
    assert.deepEqual(
      restarted.window.map((render) => render.jobId),
      first.window.map((render) => render.jobId)
    )

    // A bound larger than the backlog covers everything; an empty backlog or no bound is empty.
    assert.equal(readStudioRenderReconcileWindow(ordered, null, 99).window.length, 9)
    assert.deepEqual(readStudioRenderReconcileWindow([], null, 8), { window: [], anchor: null })
    assert.deepEqual(readStudioRenderReconcileWindow(ordered, null, 0), {
      window: [],
      anchor: null
    })

    // The order is creation time then id, whatever order the store handed over.
    const shuffled = readStudioRenderReconcileOrder([...renders].reverse())
    assert.deepEqual(
      shuffled.map((render) => render.jobId),
      ordered.map((render) => render.jobId)
    )
  })

  await run('the reconcile cursor stays bounded and a Scene keeps its own rotation', async () => {
    // The cache is a fairness hint with a hard capacity, so a long-lived process cannot grow it.
    const cursor = createStudioRenderReconcileCursor(2)
    cursor.write('scope-a', 'render_a')
    cursor.write('scope-b', 'render_b')
    cursor.write('scope-c', 'render_c')
    assert.equal(cursor.size(), 2)
    assert.equal(cursor.read('scope-a'), null)
    assert.equal(cursor.read('scope-b'), 'render_b')
    assert.equal(cursor.read('scope-c'), 'render_c')

    cursor.write('scope-b', 'render_b2')
    cursor.write('scope-d', 'render_d')
    assert.equal(cursor.read('scope-b'), 'render_b2')
    assert.equal(cursor.read('scope-c'), null)
    assert.equal(cursor.read('scope-d'), 'render_d')
    cursor.clear('scope-d')
    assert.equal(cursor.read('scope-d'), null)
    assert.equal(cursor.size(), 1)

    // Two Scenes of one Session are two scopes: an unrelated Scene cannot advance another's rotation.
    const assertScopeKey = (sceneId: string) =>
      buildStudioRenderReconcileScopeKey({ ownerId: OWNER, sessionId: 'session-1', sceneId })
    assert.notEqual(assertScopeKey('scene-a'), assertScopeKey('scene-b'))

    const makeBacklog = (sceneId: string) =>
      Array.from({ length: 9 }, (_, index) =>
        sceneRender({
          sceneId,
          jobId: `job-${sceneId}-${index}`,
          createdAt: `2026-03-22T00:00:0${index}.000Z`
        })
      )
    const sceneA = makeBacklog('scene-a')
    const sceneB = makeBacklog('scene-b')
    const results: Record<string, StudioRenderResult> = {}
    for (let index = 0; index < 9; index += 1) {
      results[`job-scene-a-${index}`] = { status: 'unknown' }
      results[`job-scene-b-${index}`] = { status: 'unknown' }
    }
    results['job-scene-a-8'] = {
      status: 'completed',
      media: [{ locator: '/videos/scene-a-8.mp4', mimeType: 'video/mp4' }]
    }

    const fixture = createReconcilerFixture(results)
    for (const render of [...sceneA, ...sceneB]) {
      await fixture.renderStore.create(render)
    }

    const inputA = {
      ownerId: OWNER,
      sessionId: sceneA[0]?.sessionId ?? '',
      sceneId: 'scene-a',
      renders: sceneA
    }
    await fixture.reconciler.reconcileSceneRenders(inputA)
    const aSecond = await fixture.reconciler.reconcileSceneRenders(inputA)
    assert.equal(aSecond.find((render) => render.jobId === 'job-scene-a-8')?.status, 'completed')

    const beforeB = fixture.calls.length
    await fixture.reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: sceneB[0]?.sessionId ?? '',
      sceneId: 'scene-b',
      renders: sceneB
    })
    const sceneBCalls = fixture.calls.slice(beforeB)
    assert.equal(sceneBCalls.length, STUDIO_RENDER_RECONCILE_MAX_PER_READ)
    assert.equal(sceneBCalls.includes('job-scene-b-8'), false)
    assert.equal(
      sceneBCalls.every((jobId) => jobId.startsWith('job-scene-b-')),
      true
    )
  })

  await run('the result error text stays internal and bounded', async () => {
    const longError = 'x'.repeat(STUDIO_RENDER_RESULT_ERROR_MAX_LENGTH + 100)
    const resultPort = createRecordingResultPort({
      [JOB_ID]: { status: 'failed', error: longError }
    })
    const renderStore = new InMemoryStudioRenderStore()
    const eventBus = new InMemoryStudioEventBus()
    const reconciler = createStudioRenderResultReconciler({
      resultPort: resultPort.port,
      renderStore,
      eventBus
    })
    const render = sceneRender({ sceneId: 'scene-1', status: 'queued', jobId: JOB_ID })
    await renderStore.create(render)

    await reconciler.reconcileSceneRenders({
      ownerId: OWNER,
      sessionId: render.sessionId,
      sceneId: 'scene-1',
      renders: [render]
    })

    const stored = await renderStore.getById(OWNER, render.id)
    assert.equal(stored?.status, 'failed')
    assert.equal(stored?.error?.length, STUDIO_RENDER_RESULT_ERROR_MAX_LENGTH)
    // The public render projection never carries the internal error.
    const publicAttachment = readPublicRenderAttachments(undefined)
    assert.deepEqual(publicAttachment, [])
  })
}
