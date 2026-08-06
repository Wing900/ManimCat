import type { StudioExternalEvent } from '../protocol/studio-agent-events'
import type {
  StudioAssistantMessage,
  StudioMessage,
  StudioRun,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'
import {
  createInitialStudioState,
  mergeStudioSnapshot,
  upsertMessages,
  upsertRuns,
  upsertRenders,
} from './studio-session-store'
import { debugStudioMessages } from '../agent-response/debug'
import {
  applyAssistantTextEvent,
  applyToolCallEvent,
  applyToolInputStartEvent,
  applyToolResultEvent,
} from '../agent-response/streaming'
import type { StudioSessionState } from './studio-types'

export type StudioStateAction =
  | { type: 'snapshot_loading' }
  | { type: 'snapshot_loaded'; snapshot: StudioSessionSnapshot }
  | { type: 'session_replacing' }
  | { type: 'session_replaced'; snapshot: StudioSessionSnapshot }
  | { type: 'snapshot_failed'; error: string }
  | { type: 'event_status'; status: StudioSessionState['connection']['eventStatus']; error?: string | null }
  | { type: 'event_received'; event: StudioExternalEvent }
  | { type: 'optimistic_messages_created'; userMessage: StudioMessage; assistantMessage: StudioAssistantMessage }
  | { type: 'run_submitting' }
  | { type: 'run_started'; run: StudioRun }
  | { type: 'run_submit_failed'; error: string }
  | { type: 'local_assistant_message'; message: StudioAssistantMessage }

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
        const merged = mergeStudioSnapshot(state, action.snapshot)
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
        const merged = mergeStudioSnapshot(createInitialStudioState(), action.snapshot)
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
      debugStudioMessages('optimistic-messages-created', {
        userMessageId: action.userMessage.id,
        assistantMessageId: action.assistantMessage.id,
      })
      return {
        ...state,
        entities: upsertMessages(state.entities, [action.userMessage, action.assistantMessage]),
        runtime: {
          ...state.runtime,
          activeRunId: null,
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
      debugStudioMessages('run-started', {
        runId: action.run.id,
        optimisticAssistantMessageId: state.runtime.pendingAssistantMessageId,
      })
      return {
        ...state,
        entities: upsertRuns(state.entities, [action.run]),
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
    case 'local_assistant_message':
      return {
        ...state,
        entities: upsertMessages(state.entities, [action.message]),
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

  if ('sessionId' in event.properties && state.entities.session && event.properties.sessionId !== state.entities.session.id) {
    return nextBase
  }

  switch (event.type) {
    case 'run.updated':
      return {
        ...nextBase,
        entities: upsertRuns(nextBase.entities, [event.properties.run]),
        runtime: {
          ...nextBase.runtime,
          activeRunId: event.properties.run.id,
        },
      }
    case 'render.updated':
      return {
        ...nextBase,
        entities: upsertRenders(nextBase.entities, [event.properties.render]),
      }
    case 'assistant.text':
      return applyAssistantTextEvent(nextBase, event.properties.runId, event.properties.text, event.properties.messageId)
    case 'tool.input-start':
      return applyToolInputStartEvent(nextBase, event.properties.runId, event.properties.callId, event.properties.toolName, event.properties.raw, event.properties.messageId)
    case 'tool.call':
      return applyToolCallEvent(nextBase, event.properties.runId, event.properties.callId, event.properties.toolName, event.properties.input, event.properties.messageId)
    case 'tool.result':
      return applyToolResultEvent(nextBase, event.properties.runId, event.properties.callId, event.properties.toolName, event.properties, event.properties.messageId)
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

function buildFailedAssistantMessage(
  state: StudioSessionState,
  messageId: string,
  error: string,
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
          text: error,
        },
        ...existing.parts.filter((part) => part.type !== 'text'),
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
        text: error,
      },
    ],
  }
}

