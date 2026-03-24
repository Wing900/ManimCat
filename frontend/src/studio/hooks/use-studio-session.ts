import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  createStudioSession,
  getPendingStudioPermissions,
  getStudioSessionSnapshot,
} from '../api/studio-agent-api'
import { useStudioControls } from '../controls/use-studio-controls'
import type { StudioKind, StudioPermissionRequest, StudioTask } from '../protocol/studio-agent-types'
import type { StudioSessionState } from '../store/studio-types'
import { useStudioEvents } from './use-studio-events'
import { useStudioPermissions } from './use-studio-permissions'
import { useStudioRun } from './use-studio-run'
import { studioEventReducer } from '../store/studio-event-reducer'
import { createInitialStudioState } from '../store/studio-session-store'
import { useI18n } from '../../i18n'
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

interface UseStudioSessionOptions {
  studioKind?: StudioKind
  title?: string
}

export function useStudioSession(options: UseStudioSessionOptions = {}) {
  const { t } = useI18n()
  const [state, dispatch] = useReducer(studioEventReducer, undefined, createInitialStudioState)
  const bootstrappedRef = useRef(false)
  const refreshInFlightRef = useRef(false)

  const loadSnapshot = useCallback(async (
    sessionId: string,
    mode: 'merge' | 'replace' = 'merge',
    options?: { silent?: boolean; ignoreErrors?: boolean },
  ) => {
    if (!options?.silent) {
      dispatch({ type: 'snapshot_loading' })
    }

    try {
      const [snapshot, pendingPermissions] = await Promise.all([
        getStudioSessionSnapshot(sessionId),
        getPendingStudioPermissions(),
      ])

      dispatch({
        type: mode === 'replace' ? 'session_replaced' : 'snapshot_loaded',
        snapshot,
        pendingPermissions: filterPermissionsForSession(pendingPermissions, sessionId),
      })
      return snapshot.session
    } catch (error) {
      if (options?.ignoreErrors) {
        return null
      }

      dispatch({
        type: 'snapshot_failed',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }, [])

  const createFreshSession = useCallback(async (mode: 'bootstrap' | 'replace' = 'bootstrap') => {
    if (mode === 'replace') {
      dispatch({ type: 'session_replacing' })
    } else {
      dispatch({ type: 'snapshot_loading' })
    }

    const session = await createStudioSession({
      projectId: 'manimcat-studio',
      title: options.title ?? getDefaultStudioTitle(options.studioKind ?? 'manim', t),
      studioKind: options.studioKind ?? 'manim',
      agentType: 'builder',
      permissionLevel: 'L2',
    })

    await loadSnapshot(session.id, mode === 'replace' ? 'replace' : 'merge')
    return session
  }, [loadSnapshot, options.studioKind, options.title, t])

  useEffect(() => {
    if (bootstrappedRef.current) {
      return
    }
    bootstrappedRef.current = true

    void (async () => {
      try {
        await createFreshSession('bootstrap')
      } catch (error) {
        dispatch({
          type: 'snapshot_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }, [createFreshSession])

  const refresh = useCallback(async () => {
    const sessionId = state.entities.session?.id
    if (sessionId) {
      await loadSnapshot(sessionId)
    }
  }, [loadSnapshot, state.entities.session?.id])

  const sessionId = state.entities.session?.id ?? null
  const activeRenderTask = hasActiveRenderTask(state)

  useEffect(() => {
    if (!sessionId || !activeRenderTask) {
      return
    }

    const refreshRenderState = async () => {
      if (refreshInFlightRef.current) {
        return
      }

      refreshInFlightRef.current = true
      try {
        await loadSnapshot(sessionId, 'merge', {
          silent: true,
          ignoreErrors: true,
        })
      } finally {
        refreshInFlightRef.current = false
      }
    }

    void refreshRenderState()
    const timer = window.setInterval(() => {
      void refreshRenderState()
    }, 4000)

    return () => window.clearInterval(timer)
  }, [activeRenderTask, loadSnapshot, sessionId])

  useStudioEvents({
    sessionId,
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
    onOptimisticMessagesCreated: ({ userMessage, assistantMessage }) => {
      dispatch({
        type: 'optimistic_messages_created',
        userMessage,
        assistantMessage,
      })
    },
    onRunSubmitting: () => {
      dispatch({
        type: 'run_submitting',
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
    onError: (error) => {
      dispatch({
        type: 'run_submit_failed',
        error,
      })
    },
    recoverSession: () => createFreshSession('replace'),
  })

  const controls = useStudioControls({
    session: state.entities.session,
    onRun: runCommand,
    onSessionUpdated: async (session) => {
      await loadSnapshot(session.id, 'merge', { silent: true })
    },
  })

  const { replyPermission } = useStudioPermissions({
    sessionId,
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
    permissionModeModal: controls.permissionModeModal,
    workSummaries: selectStudioWorks(state).map((work) => ({
      work,
      latestTask: selectLatestTaskForWork(state, work.id),
      result: selectWorkSummary(state, work).result,
    })),
    refresh,
    runCommand: async (inputText: string) => {
      await controls.submitInput(inputText)
    },
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

function getDefaultStudioTitle(studioKind: StudioKind, t: (key: 'studio.plotTitle' | 'studio.manimTitle') => string): string {
  return studioKind === 'plot' ? t('studio.plotTitle') : t('studio.manimTitle')
}

function filterPermissionsForSession(requests: StudioPermissionRequest[], sessionId?: string | null) {
  if (!sessionId) {
    return []
  }
  return requests.filter((request) => request.sessionID === sessionId)
}

function hasActiveRenderTask(state: StudioSessionState): boolean {
  const sessionId = state.entities.session?.id
  if (!sessionId) {
    return false
  }

  return state.entities.taskOrder
    .map((id) => state.entities.tasksById[id])
    .filter((task): task is StudioTask => Boolean(task))
    .some((task) => (
      task.sessionId === sessionId
      && task.type === 'render'
      && (task.status === 'queued' || task.status === 'running' || task.status === 'pending_confirmation')
    ))
}
