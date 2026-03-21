import type { StudioExternalEvent } from '../protocol/studio-agent-events'
import type { StudioPermissionRequest, StudioRun, StudioSessionSnapshot } from '../protocol/studio-agent-types'
import {
  createInitialStudioState,
  mergeStudioSnapshot,
  replacePendingPermissions,
  upsertRuns,
  upsertTasks,
  upsertWorkResults,
  upsertWorks,
} from './studio-session-store'
import type { StudioSessionState } from './studio-types'

export type StudioStateAction =
  | { type: 'snapshot_loading' }
  | { type: 'snapshot_loaded'; snapshot: StudioSessionSnapshot; pendingPermissions: StudioPermissionRequest[] }
  | { type: 'snapshot_failed'; error: string }
  | { type: 'event_status'; status: StudioSessionState['connection']['eventStatus']; error?: string | null }
  | { type: 'event_received'; event: StudioExternalEvent }
  | { type: 'run_started'; run: StudioRun; pendingPermissions: StudioPermissionRequest[] }
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
      return mergeStudioSnapshot(state, action.snapshot, action.pendingPermissions)
    case 'snapshot_failed':
      return {
        ...state,
        connection: {
          ...state.connection,
          snapshotStatus: 'error',
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
          assistantTextByRunId: {
            ...state.runtime.assistantTextByRunId,
            [action.run.id]: '',
          },
        },
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
      return {
        ...nextBase,
        runtime: {
          ...nextBase.runtime,
          activeRunId: event.properties.runId,
          assistantTextByRunId: {
            ...nextBase.runtime.assistantTextByRunId,
            [event.properties.runId]: event.properties.text,
          },
        },
      }
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

function uniqPermissions(requests: StudioPermissionRequest[]): StudioPermissionRequest[] {
  const byId = new Map<string, StudioPermissionRequest>()
  for (const request of requests) {
    byId.set(request.id, request)
  }
  return [...byId.values()]
}
