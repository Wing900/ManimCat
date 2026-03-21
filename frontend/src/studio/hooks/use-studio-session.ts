import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  createStudioSession,
  getPendingStudioPermissions,
  getStudioSessionSnapshot,
} from '../api/studio-agent-api'
import type { StudioPermissionRequest } from '../protocol/studio-agent-types'
import { useStudioEvents } from './use-studio-events'
import { useStudioPermissions } from './use-studio-permissions'
import { useStudioRun } from './use-studio-run'
import { studioEventReducer } from '../store/studio-event-reducer'
import { createInitialStudioState } from '../store/studio-session-store'
import {
  selectLatestAssistantText,
  selectLatestRun,
  selectLatestTaskForWork,
  selectSelectedWork,
  selectIsBusy,
  selectStudioMessages,
  selectStudioPendingPermissions,
  selectStudioRuns,
  selectStudioWorks,
  selectTasksForWork,
  selectWorkSummary,
  selectWorkResult,
} from '../store/studio-selectors'

export function useStudioSession() {
  const [state, dispatch] = useReducer(studioEventReducer, undefined, createInitialStudioState)
  const bootstrappedRef = useRef(false)

  const loadSnapshot = useCallback(async (sessionId: string) => {
    dispatch({ type: 'snapshot_loading' })

    try {
      const [snapshot, pendingPermissions] = await Promise.all([
        getStudioSessionSnapshot(sessionId),
        getPendingStudioPermissions(),
      ])

      dispatch({
        type: 'snapshot_loaded',
        snapshot,
        pendingPermissions: filterPermissionsForSession(pendingPermissions, sessionId),
      })
    } catch (error) {
      dispatch({
        type: 'snapshot_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => {
    if (bootstrappedRef.current) {
      return
    }
    bootstrappedRef.current = true

    void (async () => {
      dispatch({ type: 'snapshot_loading' })

      try {
        const session = await createStudioSession({
          projectId: 'manimcat-studio',
          title: 'ManimCat Studio',
          agentType: 'builder',
          permissionLevel: 'L2',
        })
        await loadSnapshot(session.id)
      } catch (error) {
        dispatch({
          type: 'snapshot_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }, [loadSnapshot])

  const refresh = useCallback(async () => {
    const sessionId = state.entities.session?.id
    if (sessionId) {
      await loadSnapshot(sessionId)
    }
  }, [loadSnapshot, state.entities.session?.id])

  useStudioEvents({
    sessionId: state.entities.session?.id ?? null,
    onEvent: (event) => {
      dispatch({ type: 'event_received', event })
    },
    onStatusChange: (status) => {
      dispatch({
        type: 'event_status',
        status: status.state,
        error: status.error,
      })
    },
  })

  const runCommand = useStudioRun({
    session: state.entities.session,
    onUserMessageSubmitted: (message) => {
      dispatch({
        type: 'user_message_submitted',
        message,
      })
    },
    onRunStarted: (run, pendingPermissions) => {
      dispatch({
        type: 'run_started',
        run,
        pendingPermissions,
      })
    },
    onSnapshotLoaded: (snapshot, pendingPermissions) => {
      dispatch({
        type: 'snapshot_loaded',
        snapshot: {
          ...snapshot,
          runs: [...selectStudioRuns(state), ...snapshot.runs],
        },
        pendingPermissions,
      })
    },
  })

  const { replyPermission } = useStudioPermissions({
    sessionId: state.entities.session?.id ?? null,
    onReplyStarted: (requestId) => {
      dispatch({ type: 'permission_reply_started', requestId })
    },
    onReplyFinished: (requests) => {
      dispatch({
        type: 'permission_reply_finished',
        requests,
      })
    },
    onError: (error) => {
      dispatch({
        type: 'event_status',
        status: state.connection.eventStatus,
        error,
      })
    },
    getFallbackRequests: () => selectStudioPendingPermissions(state),
  })

  return {
    state,
    session: state.entities.session,
    messages: selectStudioMessages(state),
    runs: selectStudioRuns(state),
    works: selectStudioWorks(state),
    pendingPermissions: selectStudioPendingPermissions(state),
    latestRun: selectLatestRun(state),
    latestAssistantText: selectLatestAssistantText(state),
    isBusy: selectIsBusy(state),
    replyingPermissionIds: state.runtime.replyingPermissionIds,
    latestQuestion: state.runtime.latestQuestion,
    workSummaries: selectStudioWorks(state).map((work) => ({
      work,
      latestTask: selectLatestTaskForWork(state, work.id),
      result: selectWorkSummary(state, work).result,
    })),
    refresh,
    runCommand,
    replyPermission,
    selectWork(workId: string | null) {
      const work = selectSelectedWork(state, workId)
      return {
        work,
        result: selectWorkResult(state, work),
        tasks: selectTasksForWork(state, work?.id),
      }
    },
  }
}

function filterPermissionsForSession(requests: StudioPermissionRequest[], sessionId?: string | null) {
  if (!sessionId) {
    return []
  }
  return requests.filter((request) => request.sessionID === sessionId)
}
