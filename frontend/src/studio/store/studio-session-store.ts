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
      submitting: false,
      replacingSession: false,
      assistantTextByRunId: {},
      optimisticAssistantMessageIdByRunId: {},
      pendingAssistantMessageId: null,
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
  const messagesById = mergeMessages(current.entities.messagesById, snapshot.messages)
  const runsById = mergeRecord(current.entities.runsById, snapshot.runs)
  const tasksById = mergeRecord(current.entities.tasksById, snapshot.tasks)
  const worksById = mergeRecord(current.entities.worksById, snapshot.works)
  const workResultsById = mergeRecord(current.entities.workResultsById, snapshot.workResults)

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
  const messagesById = mergeMessages(state.messagesById, messages)
  return {
    ...state,
    messagesById,
    messageOrder: sortMessageIds(messagesById, state.messageOrder, messages.map((item) => item.id)),
  }
}

export function upsertRuns(state: StudioEntityState, runs: StudioRun[]): StudioEntityState {
  const runsById = mergeRecord(state.runsById, runs)
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

function mergeMessages(
  current: Record<string, StudioMessage>,
  incoming: StudioMessage[],
): Record<string, StudioMessage> {
  const merged = mergeRecord(current, incoming)
  const incomingServerUserMessages = incoming.filter((message): message is Extract<StudioMessage, { role: 'user' }> => {
    return message.role === 'user' && !isOptimisticLocalMessageId(message.id)
  })
  const incomingServerAssistantMessages = incoming.filter((message): message is Extract<StudioMessage, { role: 'assistant' }> => {
    return message.role === 'assistant' && !isOptimisticLocalMessageId(message.id)
  })

  if (incomingServerUserMessages.length > 0) {
    for (const [messageId, message] of Object.entries(merged)) {
      if (message.role !== 'user' || !isOptimisticLocalMessageId(messageId)) {
        continue
      }

      const matchedServerMessage = incomingServerUserMessages.find((serverMessage) => (
        serverMessage.text === message.text && isNearSameTimestamp(serverMessage.createdAt, message.createdAt)
      ))

      if (matchedServerMessage) {
        merged[matchedServerMessage.id] = {
          ...matchedServerMessage,
          createdAt: message.createdAt,
        }
        delete merged[messageId]
      }
    }
  }

  if (incomingServerAssistantMessages.length > 0) {
    const usedAssistantMessageIds = new Set<string>()

    for (const [messageId, message] of Object.entries(merged)) {
      if (message.role !== 'assistant' || !isOptimisticLocalMessageId(messageId)) {
        continue
      }

      const matchedServerMessage = incomingServerAssistantMessages.find((serverMessage) => {
        if (usedAssistantMessageIds.has(serverMessage.id)) {
          return false
        }

        return isNearSameTimestamp(serverMessage.createdAt, message.createdAt, 30000)
      })

      if (matchedServerMessage) {
        usedAssistantMessageIds.add(matchedServerMessage.id)
        merged[matchedServerMessage.id] = {
          ...matchedServerMessage,
          createdAt: message.createdAt,
        }
        delete merged[messageId]
      }
    }
  }

  return merged
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

function isOptimisticLocalMessageId(messageId: string): boolean {
  return messageId.startsWith('local-user-') || messageId.startsWith('local-assistant-')
}

function isNearSameTimestamp(left: string, right: string, thresholdMs = 5000): boolean {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) < thresholdMs
}
