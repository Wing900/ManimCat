import { createStudioTask, createStudioWork } from '../domain/factories'
import type { StudioTask, StudioTaskStatus, StudioWork } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'

type StudioTaskCreateInput = Parameters<typeof createStudioTask>[0]
type StudioWorkCreateInput = Parameters<typeof createStudioWork>[0]

interface CreateWorkAndTaskInput {
  context: StudioRuntimeBackedToolContext
  work?: StudioWorkCreateInput
  task?: Omit<StudioTaskCreateInput, 'workId'>
  workMetadata?: Record<string, unknown>
}

interface UpdateTaskAndWorkInput {
  context: StudioRuntimeBackedToolContext
  task: StudioTask | null | undefined
  work: StudioWork | null | undefined
  taskPatch: Partial<StudioTask>
  workMetadata?: Record<string, unknown>
}

interface SyncWorkWithTaskInput {
  context: StudioRuntimeBackedToolContext
  task: Pick<StudioTask, 'id' | 'status' | 'metadata'> | null | undefined
  work: StudioWork | null | undefined
  workMetadata?: Record<string, unknown>
}

export async function createWorkAndTask(
  input: CreateWorkAndTaskInput
): Promise<{ work: StudioWork | null; task: StudioTask | null }> {
  const createdWork = input.work && input.context.workStore
    ? await input.context.workStore.create(createStudioWork(input.work))
    : null

  const createdTask = input.task && input.context.taskStore
    ? await input.context.taskStore.create(createStudioTask({
        ...input.task,
        workId: createdWork?.id
      }))
    : null

  publishTaskUpdated(input.context, createdTask)
  const syncedWork = await syncWorkWithTask({
    context: input.context,
    task: createdTask,
    work: createdWork,
    workMetadata: input.workMetadata
  })

  return {
    work: syncedWork,
    task: createdTask
  }
}

export async function updateTaskAndWork(
  input: UpdateTaskAndWorkInput
): Promise<{ task: StudioTask | null; work: StudioWork | null }> {
  const nextTask = input.task && input.context.taskStore
    ? (await input.context.taskStore.update(input.task.id, input.taskPatch)) ?? input.task
    : input.task ?? null

  publishTaskUpdated(input.context, nextTask)
  const nextWork = await syncWorkWithTask({
    context: input.context,
    task: nextTask,
    work: input.work,
    workMetadata: input.workMetadata
  })

  return {
    task: nextTask,
    work: nextWork
  }
}

export async function syncWorkWithTask(
  input: SyncWorkWithTaskInput
): Promise<StudioWork | null> {
  if (!input.work || !input.context.workStore) {
    return input.work ?? null
  }

  const updated = await input.context.workStore.update(input.work.id, {
    latestTaskId: input.task?.id,
    status: toWorkStatus(input.task?.status),
    metadata: {
      ...(input.work.metadata ?? {}),
      ...(input.task?.metadata ?? {}),
      ...(input.workMetadata ?? {})
    }
  })

  const nextWork = updated ?? input.work
  publishWorkUpdated(input.context, nextWork)
  return nextWork
}

export function publishTaskUpdated(
  context: StudioRuntimeBackedToolContext,
  task: StudioTask | null | undefined
): void {
  if (!task) {
    return
  }

  context.eventBus.publish({
    type: 'task_updated',
    sessionId: context.session.id,
    runId: context.run.id,
    task
  })
}

export function publishWorkUpdated(
  context: StudioRuntimeBackedToolContext,
  work: StudioWork | null | undefined
): void {
  if (!work) {
    return
  }

  context.eventBus.publish({
    type: 'work_updated',
    sessionId: context.session.id,
    runId: context.run.id,
    work
  })
}

function toWorkStatus(status: StudioTaskStatus | undefined): StudioWork['status'] {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'running'
  }
}
