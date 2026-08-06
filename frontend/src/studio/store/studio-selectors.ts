import type { StudioMessage, StudioRender, StudioRun } from '../protocol/studio-agent-types'
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
