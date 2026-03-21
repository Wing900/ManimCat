import type {
  StudioEventBus,
  StudioMessageStore,
  StudioPartStore,
  StudioSessionStore,
  StudioTask,
  StudioTaskStore,
  StudioWorkResultStore,
  StudioWorkStore
} from '../domain/types'
import type { StudioBlobStore } from '../storage/studio-blob-store'
import { publishRenderFailureFeedback } from '../works/render-failure-feedback'
import { syncRenderWorkFromTask } from '../works/render-work-sync'
import { getBullJobStatus, getJobResult, getJobStage } from '../../services/job-store'

interface SyncStudioRenderTaskInput {
  task: StudioTask
  taskStore: StudioTaskStore
  workStore: StudioWorkStore
  workResultStore: StudioWorkResultStore
  sessionStore: StudioSessionStore
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  eventBus: StudioEventBus
  blobStore?: StudioBlobStore
}

export async function syncStudioRenderTask(input: SyncStudioRenderTaskInput): Promise<void> {
  const jobId = typeof input.task.metadata?.jobId === 'string' ? input.task.metadata.jobId : undefined
  if (!jobId) {
    return
  }

  if (input.task.status === 'completed' || input.task.status === 'failed' || input.task.status === 'cancelled') {
    await publishRenderSync(input, input.task)
    return
  }

  const [bullStatus, result, stage] = await Promise.all([
    getBullJobStatus(jobId),
    getJobResult(jobId),
    getJobStage(jobId)
  ])

  if (bullStatus === 'active') {
    const updated = await input.taskStore.update(input.task.id, {
      status: 'running',
      metadata: {
        ...input.task.metadata,
        bullStatus,
        stage: stage || 'rendering'
      }
    })
    await publishRenderSync(input, updated ?? input.task)
    return
  }

  if (bullStatus === 'waiting' || bullStatus === 'delayed') {
    const updated = await input.taskStore.update(input.task.id, {
      status: 'queued',
      metadata: {
        ...input.task.metadata,
        bullStatus,
        stage: stage || 'rendering'
      }
    })
    await publishRenderSync(input, updated ?? input.task)
    return
  }

  if (!result) {
    return
  }

  if (result.status === 'completed') {
    const updated = await input.taskStore.update(input.task.id, {
      status: 'completed',
      metadata: {
        ...input.task.metadata,
        bullStatus: bullStatus ?? 'completed',
        result
      }
    })
    await publishRenderSync(input, updated ?? input.task)
    return
  }

  const alreadyReported = input.task.metadata?.failureReported === true
  const failedTask = await input.taskStore.update(input.task.id, {
    status: 'failed',
    metadata: {
      ...input.task.metadata,
      bullStatus: bullStatus ?? 'failed',
      stage: stage || 'rendering',
      result,
      failureReported: true
    }
  })

  const finalTask = failedTask ?? input.task
  await publishRenderSync(input, finalTask)

  if (alreadyReported) {
    return
  }

  await publishRenderFailureFeedback({
    task: finalTask,
    sessionStore: input.sessionStore,
    messageStore: input.messageStore,
    partStore: input.partStore
  })
}

async function publishRenderSync(
  input: SyncStudioRenderTaskInput,
  task: StudioTask
): Promise<void> {
  const synced = await syncRenderWorkFromTask({
    workStore: input.workStore,
    workResultStore: input.workResultStore,
    blobStore: input.blobStore
  }, task)

  if (!synced) {
    return
  }

  input.eventBus.publish({
    type: 'task_updated',
    sessionId: task.sessionId,
    runId: task.runId,
    task
  })

  input.eventBus.publish({
    type: 'work_updated',
    sessionId: synced.work.sessionId,
    runId: synced.work.runId,
    work: synced.work
  })

  if (synced.result) {
    input.eventBus.publish({
      type: 'work_result_updated',
      sessionId: synced.work.sessionId,
      runId: synced.work.runId,
      result: synced.result
    })
  }
}
