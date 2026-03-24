import type { StudioExternalEvent } from '../protocol/studio-agent-events'
import type {
  StudioAssistantMessage,
  StudioMessage,
  StudioPermissionRequest,
  StudioRun,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'
import {
  createInitialStudioState,
  mergeStudioSnapshot,
  replacePendingPermissions,
  upsertMessages,
  upsertRuns,
  upsertTasks,
  upsertWorkResults,
  upsertWorks,
} from './studio-session-store'
import type { StudioSessionState } from './studio-types'

export type StudioStateAction =
  | { type: 'snapshot_loading' }
  | { type: 'snapshot_loaded'; snapshot: StudioSessionSnapshot; pendingPermissions: StudioPermissionRequest[] }
  | { type: 'session_replacing' }
  | { type: 'session_replaced'; snapshot: StudioSessionSnapshot; pendingPermissions: StudioPermissionRequest[] }
  | { type: 'snapshot_failed'; error: string }
  | { type: 'event_status'; status: StudioSessionState['connection']['eventStatus']; error?: string | null }
  | { type: 'event_received'; event: StudioExternalEvent }
  | { type: 'optimistic_messages_created'; userMessage: StudioMessage; assistantMessage: StudioAssistantMessage }
  | { type: 'run_submitting' }
  | { type: 'run_started'; run: StudioRun; pendingPermissions: StudioPermissionRequest[] }
  | { type: 'run_submit_failed'; error: string }
  | { type: 'permission_reply_started'; requestId: string }
  | { type: 'permission_reply_finished'; requests: StudioPermissionRequest[] }

export function studioEventReducer(
  state: StudioSessionState = createInitialStudioState(),
  action: StudioStateAction,
): StudioSessionState {
  switch (action.type) {
    case 'snapshot_loading':
      return {
        ...state,
        connection: {
          ...state.connection,
          snapshotStatus: 'loading',
        },
        error: null,
      }
    case 'snapshot_loaded':
      {
        const merged = mergeStudioSnapshot(state, action.snapshot, action.pendingPermissions)
        return {
          ...merged,
          runtime: {
            ...merged.runtime,
            submitting: false,
            replacingSession: false,
          },
        }
      }
    case 'session_replacing':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          replacingSession: true,
          submitting: false,
        },
        error: null,
      }
    case 'session_replaced':
      {
        const merged = mergeStudioSnapshot(createInitialStudioState(), action.snapshot, action.pendingPermissions)
        return {
          ...merged,
          connection: {
            ...merged.connection,
            eventStatus: state.connection.eventStatus,
            eventError: state.connection.eventError,
            lastEventAt: state.connection.lastEventAt,
            lastEventType: state.connection.lastEventType,
          },
          runtime: {
            ...merged.runtime,
            replacingSession: false,
          },
        }
      }
    case 'snapshot_failed':
      return {
        ...state,
        connection: {
          ...state.connection,
          snapshotStatus: 'error',
        },
        runtime: {
          ...state.runtime,
          submitting: false,
          replacingSession: false,
        },
        error: action.error,
      }
    case 'event_status':
      return {
        ...state,
        connection: {
          ...state.connection,
          eventStatus: action.status,
          eventError: action.error ?? null,
        },
      }
    case 'event_received':
      return applyStudioExternalEvent(state, action.event)
    case 'optimistic_messages_created':
      return {
        ...state,
        entities: upsertMessages(state.entities, [action.userMessage, action.assistantMessage]),
        runtime: {
          ...state.runtime,
          pendingAssistantMessageId: action.assistantMessage.id,
        },
      }
    case 'run_submitting':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          submitting: true,
        },
      }
    case 'run_started':
      return {
        ...state,
        entities: replacePendingPermissions(
          upsertRuns(state.entities, [action.run]),
          action.pendingPermissions,
        ),
        runtime: {
          ...state.runtime,
          activeRunId: action.run.id,
          submitting: false,
          assistantTextByRunId: {
            ...state.runtime.assistantTextByRunId,
            [action.run.id]: '',
          },
          optimisticAssistantMessageIdByRunId: state.runtime.pendingAssistantMessageId
            ? {
              ...state.runtime.optimisticAssistantMessageIdByRunId,
              [action.run.id]: state.runtime.pendingAssistantMessageId,
            }
            : state.runtime.optimisticAssistantMessageIdByRunId,
          pendingAssistantMessageId: null,
        },
      }
    case 'run_submit_failed':
      return {
        ...state,
        entities: state.runtime.pendingAssistantMessageId
          ? upsertMessages(state.entities, [buildFailedAssistantMessage(state, state.runtime.pendingAssistantMessageId, action.error)])
          : state.entities,
        runtime: {
          ...state.runtime,
          submitting: false,
          pendingAssistantMessageId: null,
        },
        error: action.error,
      }
    case 'permission_reply_started':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          replyingPermissionIds: {
            ...state.runtime.replyingPermissionIds,
            [action.requestId]: true,
          },
        },
      }
    case 'permission_reply_finished':
      return {
        ...state,
        entities: replacePendingPermissions(state.entities, action.requests),
        runtime: {
          ...state.runtime,
          replyingPermissionIds: {},
        },
      }
    default:
      return state
  }
}

function applyStudioExternalEvent(state: StudioSessionState, event: StudioExternalEvent): StudioSessionState {
  const nextBase: StudioSessionState = {
    ...state,
    connection: {
      ...state.connection,
      lastEventAt: Date.now(),
      lastEventType: event.type,
    },
  }

  switch (event.type) {
    case 'task.updated':
      return {
        ...nextBase,
        entities: upsertTasks(nextBase.entities, [event.properties.task]),
      }
    case 'work.updated':
      return {
        ...nextBase,
        entities: upsertWorks(nextBase.entities, [event.properties.work]),
      }
    case 'work-result.updated':
      return {
        ...nextBase,
        entities: upsertWorkResults(nextBase.entities, [event.properties.result]),
      }
    case 'run.updated':
      return {
        ...nextBase,
        entities: upsertRuns(nextBase.entities, [event.properties.run]),
        runtime: {
          ...nextBase.runtime,
          activeRunId: event.properties.run.id,
        },
      }
    case 'assistant.text':
      return applyAssistantTextEvent(nextBase, event.properties.runId, event.properties.text)
    case 'permission.asked': {
      const requests = [
        ...nextBase.entities.pendingPermissionOrder
          .map((id) => nextBase.entities.pendingPermissionsById[id])
          .filter(Boolean),
        event.properties,
      ]
      return {
        ...nextBase,
        entities: replacePendingPermissions(nextBase.entities, uniqPermissions(requests)),
      }
    }
    case 'permission.replied': {
      const requests = nextBase.entities.pendingPermissionOrder
        .map((id) => nextBase.entities.pendingPermissionsById[id])
        .filter((request): request is StudioPermissionRequest => Boolean(request))
        .filter((request) => request.id !== event.properties.requestID)
      return {
        ...nextBase,
        entities: replacePendingPermissions(nextBase.entities, requests),
      }
    }
    case 'question.requested':
      return {
        ...nextBase,
        runtime: {
          ...nextBase.runtime,
          latestQuestion: {
            runId: event.properties.runId,
            question: event.properties.question,
            details: event.properties.details,
          },
        },
      }
    case 'studio.connected':
      return {
        ...nextBase,
        connection: {
          ...nextBase.connection,
          eventStatus: 'connected',
          eventError: null,
        },
      }
    case 'studio.heartbeat':
      return nextBase
    default:
      return nextBase
  }
}

function applyAssistantTextEvent(
  state: StudioSessionState,
  runId: string,
  text: string,
): StudioSessionState {
  const assistantMessageId = state.runtime.optimisticAssistantMessageIdByRunId[runId]
  const entities = assistantMessageId
    ? upsertMessages(state.entities, [buildStreamingAssistantMessage(state, assistantMessageId, text)])
    : state.entities

  return {
    ...state,
    entities,
    runtime: {
      ...state.runtime,
      activeRunId: runId,
      submitting: false,
      assistantTextByRunId: {
        ...state.runtime.assistantTextByRunId,
        [runId]: text,
      },
    },
  }
}

function buildStreamingAssistantMessage(
  state: StudioSessionState,
  messageId: string,
  text: string,
): StudioAssistantMessage {
  const existing = state.entities.messagesById[messageId]
  if (existing?.role === 'assistant') {
    return {
      ...existing,
      updatedAt: new Date().toISOString(),
      parts: [
        {
          id: `${messageId}-text`,
          messageId,
          sessionId: existing.sessionId,
          type: 'text',
          text,
        },
      ],
    }
  }

  const sessionId = state.entities.session?.id ?? ''
  return {
    id: messageId,
    sessionId,
    role: 'assistant',
    agent: 'builder',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    parts: [
      {
        id: `${messageId}-text`,
        messageId,
        sessionId,
        type: 'text',
        text,
      },
    ],
  }
}

function buildFailedAssistantMessage(
  state: StudioSessionState,
  messageId: string,
  error: string,
): StudioAssistantMessage {
  return buildStreamingAssistantMessage(state, messageId, error)
}

function uniqPermissions(requests: StudioPermissionRequest[]): StudioPermissionRequest[] {
  const byId = new Map<string, StudioPermissionRequest>()
  for (const request of requests) {
    byId.set(request.id, request)
  }
  return [...byId.values()]
}
