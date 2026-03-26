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
  const runsById = mergeRuns(current.entities.runsById, snapshot.runs)
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

    const remainingOptimisticAssistantEntries = Object.entries(merged)
      .filter((entry): entry is [string, Extract<StudioMessage, { role: 'assistant' }>] => {
        const [messageId, message] = entry
        return message.role === 'assistant' && isOptimisticLocalMessageId(messageId)
      })
      .sort(([, left], [, right]) => compareByCreatedAt(left, right))

    const remainingServerAssistantMessages = incomingServerAssistantMessages
      .filter((message) => !usedAssistantMessageIds.has(message.id))
      .sort(compareByCreatedAt)

    for (const [messageId, message] of remainingOptimisticAssistantEntries) {
      const matchedServerMessage = remainingServerAssistantMessages.find((serverMessage) => (
        isEmptyAssistantPlaceholder(message)
          || doAssistantMessagesLookEquivalent(message, serverMessage)
      ))
      if (!matchedServerMessage) {
        continue
      }

      const matchedIndex = remainingServerAssistantMessages.findIndex((candidate) => candidate.id === matchedServerMessage.id)
      if (matchedIndex >= 0) {
        remainingServerAssistantMessages.splice(matchedIndex, 1)
      }

      merged[matchedServerMessage.id] = {
        ...matchedServerMessage,
        createdAt: message.createdAt,
      }
      delete merged[messageId]
    }
  }

  return merged
}

function mergeRuns(current: Record<string, StudioRun>, incoming: StudioRun[]): Record<string, StudioRun> {
  return incoming.reduce<Record<string, StudioRun>>((next, candidate) => {
    const existing = next[candidate.id]
    next[candidate.id] = existing ? preferNewerRun(existing, candidate) : candidate
    return next
  }, { ...current })
}

function preferNewerRun(current: StudioRun, incoming: StudioRun): StudioRun {
  const currentTerminal = isTerminalRunStatus(current.status)
  const incomingTerminal = isTerminalRunStatus(incoming.status)

  if (currentTerminal && !incomingTerminal) {
    return current
  }

  if (!currentTerminal && incomingTerminal) {
    return incoming
  }

  const currentCompletedAt = parseTimestamp(current.completedAt)
  const incomingCompletedAt = parseTimestamp(incoming.completedAt)
  if (currentCompletedAt !== null || incomingCompletedAt !== null) {
    if ((currentCompletedAt ?? -1) > (incomingCompletedAt ?? -1)) {
      return current
    }
    if ((incomingCompletedAt ?? -1) > (currentCompletedAt ?? -1)) {
      return incoming
    }
  }

  return incoming
}

function isEmptyAssistantPlaceholder(message: Extract<StudioMessage, { role: 'assistant' }>): boolean {
  return !message.parts.some((part) => {
    if (part.type === 'tool') {
      return true
    }

    return Boolean(part.text.trim())
  })
}

function doAssistantMessagesLookEquivalent(
  left: Extract<StudioMessage, { role: 'assistant' }>,
  right: Extract<StudioMessage, { role: 'assistant' }>,
): boolean {
  const leftText = extractAssistantComparableText(left)
  const rightText = extractAssistantComparableText(right)
  if (!leftText || !rightText) {
    return false
  }

  return leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText)
}

function extractAssistantComparableText(message: Extract<StudioMessage, { role: 'assistant' }>): string {
  return message.parts
    .filter((part) => part.type === 'text' || part.type === 'reasoning')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
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

function isTerminalRunStatus(status: StudioRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function parseTimestamp(value?: string): number | null {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}
