import assert from 'node:assert/strict'
import { createStudioRender, createStudioRun, createStudioSession } from '../../domain/factories'
import { createInMemoryStudioPersistence } from '../../infrastructure/persistence/in-memory-studio-persistence'
import { InMemoryStudioEventBus } from '../../infrastructure/events/event-bus'
import { cancelStudioRunRenders } from '../../render/cancel-run-renders'
import { createStudioRunService } from '../../runtime/run-service'
import { StudioRunCoordinationService } from '../../infrastructure/coordination/studio-run-coordination-service'
import { createInMemoryStudioRunCoordinator } from '../../infrastructure/coordination/in-memory-studio-run-coordinator'
import { run, createTestManimRenderDriver, createTestDriverRegistry } from './factories'

export async function runRenderCancellationTests(): Promise<void> {
  for (const status of ['running', 'completed'] as const) {
    await run(`Stop cancels queue jobs when model Run is ${status}`, async () => {
      const persistence = createInMemoryStudioPersistence()
      const eventBus = new InMemoryStudioEventBus()
      const session = createStudioSession({ studioKind: 'manim', ownerId: 'owner', projectId: 'project', directory: '/workspace', agentType: 'builder', title: 'Stop review' })
      await persistence.sessionStore.create(session)
      const record = createStudioRun({ ownerId: session.ownerId, sessionId: session.id,
        inputText: 'render', activeAgent: 'builder', sceneId: 'scene_a' })
      record.status = status
      await persistence.runStore.create(record)
      const own = createStudioRender({ ownerId: record.ownerId, sessionId: record.sessionId,
        runId: record.id, sceneId: record.sceneId, kind: 'manim', title: 'own', concept: 'own',
        status: 'running', jobId: 'own-job', outputMode: 'video', quality: 'low' })
      const sibling = { ...own, id: 'sibling-render', runId: 'sibling-run', sceneId: 'scene_b', jobId: 'sibling-job' }
      const finished = { ...own, id: 'finished-render', status: 'completed' as const, jobId: 'finished-job' }
      await persistence.renderStore.create(own)
      await persistence.renderStore.create(sibling)
      await persistence.renderStore.create(finished)
      const cancelled: string[] = []
      const service = createStudioRunService({ persistence, eventBus,
        runtime: { async startBackgroundRun() { throw new Error('must not start a Run') } },
        coordination: new StudioRunCoordinationService({ coordinator: createInMemoryStudioRunCoordinator(),
          runStore: persistence.runStore, eventBus }),
        driverRegistry: createTestDriverRegistry([
          createTestManimRenderDriver({
            async cancel(jobId) { cancelled.push(jobId); return 'cancelled' }
          })
        ])
      })
      const result = await service.cancelRun({ ownerId: record.ownerId, runId: record.id })
      assert.equal(result.status, status === 'completed' ? 'already_finished' : 'cancelled')
      assert.deepEqual(cancelled, ['own-job'])
      assert.equal((await persistence.renderStore.getById(record.ownerId, own.id))?.status, 'cancelled')
      assert.equal((await persistence.renderStore.getById(record.ownerId, sibling.id))?.status, 'running')
      assert.equal((await persistence.renderStore.getById(record.ownerId, finished.id))?.status, 'completed')
      await service.cancelRun({ ownerId: record.ownerId, runId: record.id })
      assert.deepEqual(cancelled, ['own-job'])
      assert.equal((await service.cancelRun({ ownerId: 'other', runId: record.id })).status, 'not_found')
    })
  }

  await run('an unavailable queue cancellation never claims a cancelled Render', async () => {
    const persistence = createInMemoryStudioPersistence()
    const record = createStudioRun({ ownerId: 'owner', sessionId: 'session', inputText: 'render', activeAgent: 'builder' })
    const render = createStudioRender({ ownerId: record.ownerId, sessionId: record.sessionId,
      runId: record.id, kind: 'manim', title: 'render', concept: 'render', status: 'queued',
      jobId: 'job', outputMode: 'video', quality: 'low' })
    await persistence.renderStore.create(render)
    await assert.rejects(() => cancelStudioRunRenders({ run: record, renderStore: persistence.renderStore,
      eventBus: new InMemoryStudioEventBus(), driverRegistry: createTestDriverRegistry([
        createTestManimRenderDriver({
          async cancel() { throw new Error('queue unavailable') }
        })
      ]) }), /queue unavailable/)
    assert.equal((await persistence.renderStore.getById(record.ownerId, render.id))?.status, 'queued')
  })
}
