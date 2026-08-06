import type { StudioReviewChangeSet, StudioReviewFinding, StudioReviewMetadata } from '../protocol/studio-review-types'
import type { StudioMessage, StudioRender, StudioRun, StudioTask, StudioWork, StudioWorkResult } from '../protocol/studio-agent-types'
import type { StudioSessionState } from './studio-types'

export function selectStudioMessages(state: StudioSessionState): StudioMessage[] {
  const sessionId = state.entities.session?.id
  return state.entities.messageOrder
    .map((id) => state.entities.messagesById[id])
    .filter((message): message is StudioMessage => Boolean(message))
    .filter((message) => (sessionId ? message.sessionId === sessionId : true))
}

export function selectStudioRuns(state: StudioSessionState): StudioRun[] {
  const sessionId = state.entities.session?.id
  return state.entities.runOrder
    .map((id) => state.entities.runsById[id])
    .filter((run): run is StudioRun => Boolean(run))
    .filter((run) => (sessionId ? run.sessionId === sessionId : true))
    .reverse()
}

export function selectStudioWorks(state: StudioSessionState): StudioWork[] {
  const sessionId = state.entities.session?.id
  return state.entities.workOrder
    .map((id) => state.entities.worksById[id])
    .filter((work): work is StudioWork => Boolean(work))
    .filter((work) => (sessionId ? work.sessionId === sessionId : true))
}

export function selectStudioRenders(state: StudioSessionState): StudioRender[] {
  const sessionId = state.entities.session?.id
  return state.entities.renderOrder
    .map((id) => state.entities.rendersById[id])
    .filter((render): render is StudioRender => Boolean(render))
    .filter((render) => (sessionId ? render.sessionId === sessionId : true))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
}

export function selectLatestRender(state: StudioSessionState): StudioRender | null {
  return selectStudioRenders(state)[0] ?? null
}

export function selectActiveRender(state: StudioSessionState): StudioRender | null {
  return selectStudioRenders(state).find((render) => render.status === 'queued' || render.status === 'running') ?? null
}

export function selectRenderPreview(state: StudioSessionState, renderId?: string | null): StudioRender | null {
  if (renderId) {
    return selectStudioRenders(state).find((render) => render.id === renderId) ?? null
  }
  return selectLatestRender(state)
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
  const sessionId = state.entities.session?.id
  return state.entities.taskOrder
    .map((id) => state.entities.tasksById[id])
    .filter((task): task is StudioTask => Boolean(task))
    .filter((task) => (sessionId ? task.sessionId === sessionId : true))
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
  return state.runtime.submitting || state.runtime.replacingSession || Boolean(run && (run.status === 'pending' || run.status === 'running'))
}

export function createStudioViewSelectors() {
  const messagesCache = createStableSessionListCache<StudioMessage>()
  const runsCache = createStableSessionListCache<StudioRun>()
  const worksCache = createStableSessionListCache<StudioWork>()
  const rendersCache = createStableSessionListCache<StudioRender>()

  return {
    selectStudioMessages(state: StudioSessionState): StudioMessage[] {
      return selectStableSessionList({
        state,
        order: state.entities.messageOrder,
        getById: (id) => state.entities.messagesById[id],
        cache: messagesCache,
      })
    },
    selectStudioRuns(state: StudioSessionState): StudioRun[] {
      return selectStableSessionList({
        state,
        order: [...state.entities.runOrder].reverse(),
        getById: (id) => state.entities.runsById[id],
        cache: runsCache,
      })
    },
    selectStudioWorks(state: StudioSessionState): StudioWork[] {
      return selectStableSessionList({
        state,
        order: state.entities.workOrder,
        getById: (id) => state.entities.worksById[id],
        cache: worksCache,
      })
    },
    selectStudioRenders(state: StudioSessionState): StudioRender[] {
      return selectStableSessionList({
        state,
        order: state.entities.renderOrder,
        getById: (id) => state.entities.rendersById[id],
        cache: rendersCache,
      })
    },
  }
}

interface StableListCache<T> {
  ids: string[]
  items: T[]
}

interface StableSessionListCache<T extends { sessionId: string }> extends StableListCache<T> {
  sessionId: string | null
}

function createStableSessionListCache<T extends { sessionId: string }>(): StableSessionListCache<T> {
  return {
    sessionId: null,
    ids: [],
    items: [],
  }
}

function selectStableSessionList<T extends { id: string; sessionId: string }>(input: {
  state: StudioSessionState
  order: string[]
  getById: (id: string) => T | undefined
  cache: StableSessionListCache<T>
}): T[] {
  const sessionId = input.state.entities.session?.id ?? null
  const nextItems: T[] = []
  const nextIds: string[] = []

  for (const id of input.order) {
    const item = input.getById(id)
    if (!item) {
      continue
    }
    if (sessionId && item.sessionId !== sessionId) {
      continue
    }
    nextItems.push(item)
    nextIds.push(item.id)
  }

  if (input.cache.sessionId === sessionId && areStableListsEquivalent(input.cache, nextIds, nextItems)) {
    return input.cache.items
  }

  input.cache.sessionId = sessionId
  input.cache.ids = nextIds
  input.cache.items = nextItems
  return nextItems
}

function areStableListsEquivalent<T>(cache: StableListCache<T>, nextIds: string[], nextItems: T[]): boolean {
  if (cache.ids.length !== nextIds.length || cache.items.length !== nextItems.length) {
    return false
  }

  for (let index = 0; index < nextIds.length; index += 1) {
    if (cache.ids[index] !== nextIds[index]) {
      return false
    }
    if (cache.items[index] !== nextItems[index]) {
      return false
    }
  }

  return true
}
