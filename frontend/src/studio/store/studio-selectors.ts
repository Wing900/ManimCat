import type { StudioReviewChangeSet, StudioReviewFinding, StudioReviewMetadata } from '../protocol/studio-review-types'
import type { StudioMessage, StudioRun, StudioTask, StudioWork, StudioWorkResult } from '../protocol/studio-agent-types'
import type { StudioSessionState } from './studio-types'

export function selectStudioMessages(state: StudioSessionState): StudioMessage[] {
  return state.entities.messageOrder.map((id) => state.entities.messagesById[id]).filter(Boolean)
}

export function selectStudioRuns(state: StudioSessionState): StudioRun[] {
  return state.entities.runOrder.map((id) => state.entities.runsById[id]).filter(Boolean).reverse()
}

export function selectStudioWorks(state: StudioSessionState): StudioWork[] {
  return state.entities.workOrder.map((id) => state.entities.worksById[id]).filter(Boolean)
}

export function selectStudioPendingPermissions(state: StudioSessionState) {
  return state.entities.pendingPermissionOrder
    .map((id) => state.entities.pendingPermissionsById[id])
    .filter(Boolean)
}

export function selectLatestRun(state: StudioSessionState): StudioRun | null {
  return selectStudioRuns(state)[0] ?? null
}

export function selectSelectedWork(state: StudioSessionState, workId: string | null): StudioWork | null {
  if (!workId) {
    return selectStudioWorks(state)[0] ?? null
  }
  return state.entities.worksById[workId] ?? null
}

export function selectTasksForWork(state: StudioSessionState, workId?: string): StudioTask[] {
  return state.entities.taskOrder
    .map((id) => state.entities.tasksById[id])
    .filter((task): task is StudioTask => Boolean(task))
    .filter((task) => (workId ? task.workId === workId : true))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
}

export function selectWorkResult(state: StudioSessionState, work?: StudioWork | null): StudioWorkResult | null {
  if (!work?.currentResultId) {
    return null
  }
  return state.entities.workResultsById[work.currentResultId] ?? null
}

export function selectReviewMetadata(result: StudioWorkResult | null): StudioReviewMetadata | null {
  if (!result || result.kind !== 'review-report') {
    return null
  }
  return (result.metadata ?? null) as StudioReviewMetadata | null
}

export interface StudioReviewViewModel {
  findings: StudioReviewFinding[]
  summary: string | null
  report: string | null
  changeSet: StudioReviewChangeSet | null
  sourceLabel: string | null
  sourceKind: StudioReviewMetadata['sourceKind'] | null
  path: string | null
}

export function selectReviewViewModel(result: StudioWorkResult | null): StudioReviewViewModel | null {
  const review = selectReviewMetadata(result)
  if (!review) {
    return null
  }

  return {
    findings: review.findings ?? review.review?.findings ?? [],
    summary: review.review?.summary ?? null,
    report: review.report ?? null,
    changeSet: review.changeSet ?? null,
    sourceLabel: review.sourceLabel ?? null,
    sourceKind: review.sourceKind ?? null,
    path: review.path ?? null,
  }
}

export function selectLatestTaskForWork(state: StudioSessionState, workId?: string): StudioTask | null {
  return selectTasksForWork(state, workId).at(-1) ?? null
}

export function selectWorkSummary(
  state: StudioSessionState,
  work: StudioWork | null,
): { latestTask: StudioTask | null; result: StudioWorkResult | null } {
  if (!work) {
    return {
      latestTask: null,
      result: null,
    }
  }

  return {
    latestTask: work.latestTaskId
      ? state.entities.tasksById[work.latestTaskId] ?? selectLatestTaskForWork(state, work.id)
      : selectLatestTaskForWork(state, work.id),
    result: selectWorkResult(state, work),
  }
}

export function selectLatestAssistantText(state: StudioSessionState): string {
  const runId = state.runtime.activeRunId
  return runId ? state.runtime.assistantTextByRunId[runId] ?? '' : ''
}

export function selectIsBusy(state: StudioSessionState): boolean {
  const run = selectLatestRun(state)
  return Boolean(run && (run.status === 'pending' || run.status === 'running'))
}
