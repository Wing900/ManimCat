import type {
  StudioMessage,
  StudioRun,
  StudioRender,
  StudioSessionSnapshot,
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from '../protocol/studio-agent-types'
import { mergeMessages, preferNewerRun } from '../agent-response/reconciler'
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
      submitting: false,
      replacingSession: false,
      assistantTextByRunId: {},
      optimisticAssistantMessageIdByRunId: {},
      pendingAssistantMessageId: null,
      latestQuestion: null,
    },
    error: null,
  }
}

export function mergeStudioSnapshot(
  current: StudioSessionState,
  snapshot: StudioSessionSnapshot,
): StudioSessionState {
  const messagesById = mergeMessages(current.entities.messagesById, snapshot.messages)
  const runsById = mergeRuns(current.entities.runsById, snapshot.runs)
  const tasksById = mergeRecord(current.entities.tasksById, snapshot.tasks)
  const worksById = mergeRecord(current.entities.worksById, snapshot.works)
  const workResultsById = mergeRecord(current.entities.workResultsById, snapshot.workResults)
  const rendersById = mergeRecord(current.entities.rendersById, snapshot.renders ?? [])

  return {
    ...current,
    entities: {
      session: snapshot.session,
      messagesById,
      messageOrder: sortMessageIds(messagesById, current.entities.messageOrder, snapshot.messages.map((item) => item.id)),
      runsById,
      runOrder: sortRecordIdsBy(runsById, compareByCreatedAt),
      tasksById,
      taskOrder: sortRecordIdsBy(tasksById, compareByUpdatedAt),
      worksById,
      workOrder: sortRecordIdsBy(worksById, compareByUpdatedAt),
      workResultsById,
      workResultOrder: sortRecordIdsBy(workResultsById, compareByCreatedAt),
      rendersById,
      renderOrder: sortRecordIdsBy(rendersById, compareByUpdatedAt),
    },
    connection: {
      ...current.connection,
      snapshotStatus: 'ready',
    },
    runtime: {
      ...current.runtime,
      activeRunId: pickLatestRunId(snapshot.runs),
      optimisticAssistantMessageIdByRunId: remapOptimisticAssistantMessageIds(
        current.runtime.optimisticAssistantMessageIdByRunId,
        messagesById,
      ),
      pendingAssistantMessageId: remapMessageId(current.runtime.pendingAssistantMessageId, messagesById),
    },
    error: null,
  }
}

export function upsertMessages(state: StudioEntityState, messages: StudioMessage[]): StudioEntityState {
  const messagesById = mergeMessages(state.messagesById, messages)
  return {
    ...state,
    messagesById,
    messageOrder: sortMessageIds(messagesById, state.messageOrder, messages.map((item) => item.id)),
  }
}

export function upsertRuns(state: StudioEntityState, runs: StudioRun[]): StudioEntityState {
  const runsById = mergeRuns(state.runsById, runs)
  return {
    ...state,
    runsById,
    runOrder: sortRecordIdsBy(runsById, compareByCreatedAt),
  }
}

export function upsertTasks(state: StudioEntityState, tasks: StudioTask[]): StudioEntityState {
  const tasksById = mergeRecord(state.tasksById, tasks)
  return {
    ...state,
    tasksById,
    taskOrder: sortRecordIdsBy(tasksById, compareByUpdatedAt),
  }
}

export function upsertWorks(state: StudioEntityState, works: StudioWork[]): StudioEntityState {
  const worksById = mergeRecord(state.worksById, works)
  return {
    ...state,
    worksById,
    workOrder: sortRecordIdsBy(worksById, compareByUpdatedAt),
  }
}

export function upsertWorkResults(state: StudioEntityState, results: StudioWorkResult[]): StudioEntityState {
  const workResultsById = mergeRecord(state.workResultsById, results)
  return {
    ...state,
    workResultsById,
    workResultOrder: sortRecordIdsBy(workResultsById, compareByCreatedAt),
  }
}

export function removeMessages(state: StudioEntityState, messageIds: string[]): StudioEntityState {
  if (messageIds.length === 0) {
    return state
  }

  const nextMessagesById = { ...state.messagesById }
  for (const messageId of messageIds) {
    delete nextMessagesById[messageId]
  }

  return {
    ...state,
    messagesById: nextMessagesById,
    messageOrder: state.messageOrder.filter((id) => !messageIds.includes(id)),
  }
}

export function upsertRenders(state: StudioEntityState, renders: StudioRender[]): StudioEntityState {
  const rendersById = mergeRecord(state.rendersById, renders)
  return {
    ...state,
    rendersById,
    renderOrder: sortRecordIdsBy(rendersById, compareByUpdatedAt),
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
    rendersById: {},
    renderOrder: [],
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

function mergeRuns(current: Record<string, StudioRun>, incoming: StudioRun[]): Record<string, StudioRun> {
  return incoming.reduce<Record<string, StudioRun>>((next, candidate) => {
    const existing = next[candidate.id]
    next[candidate.id] = existing ? preferNewerRun(existing, candidate) : candidate
    return next
  }, { ...current })
}

function sortRecordIdsBy<T extends { id: string }>(
  record: Record<string, T>,
  compare: (left: T, right: T) => number,
): string[] {
  return Object.values(record)
    .sort((left, right) => {
      const result = compare(left, right)
      if (result !== 0) {
        return result
      }
      return left.id.localeCompare(right.id)
    })
    .map((item) => item.id)
}

function sortMessageIds(
  record: Record<string, StudioMessage>,
  currentOrder: string[],
  incomingIds: string[],
): string[] {
  const existingOrder = currentOrder.filter((id) => Boolean(record[id]))
  const nextOrder = [...existingOrder]

  for (const id of incomingIds) {
    if (record[id] && !nextOrder.includes(id)) {
      nextOrder.push(id)
    }
  }

  const missingIds = Object.keys(record).filter((id) => !nextOrder.includes(id))
  nextOrder.push(...missingIds)
  return nextOrder
}

function compareByCreatedAt<T extends { createdAt: string }>(left: T, right: T): number {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
}

function compareByUpdatedAt<T extends { updatedAt: string }>(left: T, right: T): number {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
}

function pickLatestRunId(runs: StudioRun[]): string | null {
  return [...runs]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.id ?? null
}

function remapOptimisticAssistantMessageIds(
  mapping: Record<string, string>,
  messagesById: Record<string, StudioMessage>,
): Record<string, string> {
  const nextEntries = Object.entries(mapping).map(([runId, messageId]) => [
    runId,
    remapMessageId(messageId, messagesById) ?? messageId,
  ] as const)

  let changed = false
  for (const [runId, messageId] of nextEntries) {
    if (mapping[runId] !== messageId) {
      changed = true
      break
    }
  }

  return changed ? Object.fromEntries(nextEntries) : mapping
}

function remapMessageId(
  messageId: string | null | undefined,
  messagesById: Record<string, StudioMessage>,
): string | null {
  if (!messageId) {
    return null
  }

  if (messagesById[messageId]) {
    return messageId
  }

  const adoptedMessage = Object.values(messagesById).find((message) => (
    message.role === 'assistant' && (message.renderId ?? message.id) === messageId
  ))

  return adoptedMessage?.id ?? null
}
