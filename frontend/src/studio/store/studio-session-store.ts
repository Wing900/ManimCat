import type {
  StudioMessage,
  StudioPermissionRequest,
  StudioRun,
  StudioSessionSnapshot,
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from '../protocol/studio-agent-types'
import type { StudioEntityState, StudioSessionState } from './studio-types'

export function createInitialStudioState(): StudioSessionState {
  return {
    entities: createEmptyEntityState(),
    connection: {
      snapshotStatus: 'idle',
      eventStatus: 'idle',
      eventError: null,
      lastEventAt: null,
      lastEventType: null,
    },
    runtime: {
      activeRunId: null,
      assistantTextByRunId: {},
      replyingPermissionIds: {},
      latestQuestion: null,
    },
    error: null,
  }
}

export function mergeStudioSnapshot(
  current: StudioSessionState,
  snapshot: StudioSessionSnapshot,
  pendingPermissions: StudioPermissionRequest[],
): StudioSessionState {
  return {
    ...current,
    entities: {
      session: snapshot.session,
      messagesById: indexById(snapshot.messages),
      messageOrder: sortByCreatedAt(snapshot.messages).map((item) => item.id),
      runsById: indexById(snapshot.runs),
      runOrder: sortByCreatedAt(snapshot.runs).map((item) => item.id),
      tasksById: indexById(snapshot.tasks),
      taskOrder: sortByUpdatedAt(snapshot.tasks).map((item) => item.id),
      worksById: indexById(snapshot.works),
      workOrder: sortByUpdatedAt(snapshot.works).map((item) => item.id),
      workResultsById: indexById(snapshot.workResults),
      workResultOrder: sortByCreatedAt(snapshot.workResults).map((item) => item.id),
      pendingPermissionsById: indexById(pendingPermissions),
      pendingPermissionOrder: pendingPermissions.map((item) => item.id),
    },
    connection: {
      ...current.connection,
      snapshotStatus: 'ready',
    },
    runtime: {
      ...current.runtime,
      activeRunId: pickLatestRunId(snapshot.runs),
    },
    error: null,
  }
}

export function upsertMessages(state: StudioEntityState, messages: StudioMessage[]): StudioEntityState {
  return {
    ...state,
    messagesById: mergeRecord(state.messagesById, messages),
    messageOrder: mergeOrderedIds(state.messageOrder, messages, compareByCreatedAt),
  }
}

export function upsertRuns(state: StudioEntityState, runs: StudioRun[]): StudioEntityState {
  return {
    ...state,
    runsById: mergeRecord(state.runsById, runs),
    runOrder: mergeOrderedIds(state.runOrder, runs, compareByCreatedAt),
  }
}

export function upsertTasks(state: StudioEntityState, tasks: StudioTask[]): StudioEntityState {
  return {
    ...state,
    tasksById: mergeRecord(state.tasksById, tasks),
    taskOrder: mergeOrderedIds(state.taskOrder, tasks, compareByUpdatedAt),
  }
}

export function upsertWorks(state: StudioEntityState, works: StudioWork[]): StudioEntityState {
  return {
    ...state,
    worksById: mergeRecord(state.worksById, works),
    workOrder: mergeOrderedIds(state.workOrder, works, compareByUpdatedAt),
  }
}

export function upsertWorkResults(state: StudioEntityState, results: StudioWorkResult[]): StudioEntityState {
  return {
    ...state,
    workResultsById: mergeRecord(state.workResultsById, results),
    workResultOrder: mergeOrderedIds(state.workResultOrder, results, compareByCreatedAt),
  }
}

export function replacePendingPermissions(
  state: StudioEntityState,
  requests: StudioPermissionRequest[],
): StudioEntityState {
  return {
    ...state,
    pendingPermissionsById: indexById(requests),
    pendingPermissionOrder: requests.map((item) => item.id),
  }
}

function createEmptyEntityState(): StudioEntityState {
  return {
    session: null,
    messagesById: {},
    messageOrder: [],
    runsById: {},
    runOrder: [],
    tasksById: {},
    taskOrder: [],
    worksById: {},
    workOrder: [],
    workResultsById: {},
    workResultOrder: [],
    pendingPermissionsById: {},
    pendingPermissionOrder: [],
  }
}

function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

function mergeRecord<T extends { id: string }>(current: Record<string, T>, items: T[]): Record<string, T> {
  return items.reduce<Record<string, T>>((next, item) => {
    next[item.id] = item
    return next
  }, { ...current })
}

function mergeOrderedIds<T extends { id: string }>(
  currentOrder: string[],
  items: T[],
  compare: (left: T, right: T) => number,
): string[] {
  const all = [...new Set([...currentOrder, ...items.map((item) => item.id)])]
  const byId = new Map(items.map((item) => [item.id, item]))

  return all.sort((leftId, rightId) => {
    const left = byId.get(leftId)
    const right = byId.get(rightId)
    if (!left || !right) {
      return currentOrder.indexOf(leftId) - currentOrder.indexOf(rightId)
    }
    return compare(left, right)
  })
}

function compareByCreatedAt<T extends { createdAt: string }>(left: T, right: T): number {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
}

function compareByUpdatedAt<T extends { updatedAt: string }>(left: T, right: T): number {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
}

function sortByCreatedAt<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort(compareByCreatedAt)
}

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort(compareByUpdatedAt)
}

function pickLatestRunId(runs: StudioRun[]): string | null {
  return [...runs]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.id ?? null
}
