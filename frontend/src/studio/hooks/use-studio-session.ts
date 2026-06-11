import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  cancelStudioRun,
  createStudioSession,
  getStudioSessionSnapshot,
} from '../api/studio-agent-api'
import type { StudioKind, StudioMessage, StudioTask } from '../protocol/studio-agent-types'
import type { StudioSessionState } from '../store/studio-types'
import { useStudioEvents } from './use-studio-events'
import { useStudioRun } from './use-studio-run'
import { studioEventReducer } from '../store/studio-event-reducer'
import { createInitialStudioState } from '../store/studio-session-store'
import { useI18n } from '../../i18n'
import {
  createStudioViewSelectors,
  selectLatestAssistantText,
  selectLatestRun,
  selectLatestTaskForWork,
  selectSelectedWork,
  selectIsBusy,
  selectTasksForWork,
  selectWorkSummary,
  selectWorkResult,
} from '../store/studio-selectors'
import {
  forgetStudioSessionId,
  readLastStudioSessionId,
  readRecentStudioSessionIds,
  rememberStudioSessionId,
} from '../session-history/session-storage'
import type { StudioAssistantMessage } from '../protocol/studio-agent-types'

interface UseStudioSessionOptions {
  studioKind?: StudioKind
  title?: string
}

export interface StudioSessionHistoryEntry {
  id: string
  title: string
  studioKind: StudioKind
  updatedAt: string
  previewText: string
}

export function useStudioSession(options: UseStudioSessionOptions = {}) {
  const { t } = useI18n()
  const studioKind = options.studioKind ?? 'manim'
  const studioTitle = options.title ?? getDefaultStudioTitle(studioKind, t)
  const [state, dispatch] = useReducer(studioEventReducer, undefined, createInitialStudioState)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<StudioSessionHistoryEntry[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const bootstrappedRef = useRef(false)
  const refreshInFlightRef = useRef(false)
  const viewSelectorsRef = useRef(createStudioViewSelectors())
  const viewSelectors = viewSelectorsRef.current

  const loadSnapshot = useCallback(async (
    sessionId: string,
    mode: 'merge' | 'replace' = 'merge',
    options?: { silent?: boolean; ignoreErrors?: boolean },
  ) => {
    if (!options?.silent) {
      dispatch({ type: 'snapshot_loading' })
    }

    try {
      const snapshot = await getStudioSessionSnapshot(sessionId)

      dispatch({
        type: mode === 'replace' ? 'session_replaced' : 'snapshot_loaded',
        snapshot,
      })
      rememberStudioSessionId(studioKind, snapshot.session.id)
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
  }, [studioKind])

  const createFreshSession = useCallback(async (mode: 'bootstrap' | 'replace' = 'bootstrap') => {
    if (mode === 'replace') {
      dispatch({ type: 'session_replacing' })
    } else {
      dispatch({ type: 'snapshot_loading' })
    }

    const session = await createStudioSession({
      projectId: 'manimcat-studio',
      title: studioTitle,
      studioKind,
      agentType: 'builder',
    })

    await loadSnapshot(session.id, mode === 'replace' ? 'replace' : 'merge')
    return session
  }, [loadSnapshot, studioKind, studioTitle])

  const restoreSession = useCallback(async (
    targetSessionId: string,
    mode: 'bootstrap' | 'replace' = 'replace',
  ) => {
    const session = await loadSnapshot(targetSessionId, mode === 'replace' ? 'replace' : 'merge')
    if (!session) {
      throw new Error('Failed to restore studio session')
    }
    return session
  }, [loadSnapshot])

  const refreshHistory = useCallback(async () => {
    const recentSessionIds = readRecentStudioSessionIds(studioKind)
    if (recentSessionIds.length === 0) {
      setHistoryEntries([])
      return
    }

    setIsHistoryLoading(true)
    try {
      const snapshots = await Promise.all(
        recentSessionIds.map(async (sessionId) => {
          try {
            return await getStudioSessionSnapshot(sessionId)
          } catch {
            forgetStudioSessionId(studioKind, sessionId)
            return null
          }
        }),
      )

      const entries = snapshots
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot))
        .map((snapshot) => buildHistoryEntry(snapshot))
        .filter((entry) => entry.studioKind === studioKind)

      setHistoryEntries(entries)
    } finally {
      setIsHistoryLoading(false)
    }
  }, [studioKind])

  const openHistory = useCallback(() => {
    setIsHistoryOpen(true)
    void refreshHistory()
  }, [refreshHistory])

  const closeHistory = useCallback(() => {
    setIsHistoryOpen(false)
  }, [])

  useEffect(() => {
    if (bootstrappedRef.current) {
      return
    }
    bootstrappedRef.current = true

    void (async () => {
      try {
        const lastSessionId = readLastStudioSessionId(studioKind)
        if (lastSessionId) {
          const restored = await loadSnapshot(lastSessionId, 'replace', {
            ignoreErrors: true,
          })

          if (restored) {
            return
          }

          forgetStudioSessionId(studioKind, lastSessionId)
        }

        await createFreshSession('bootstrap')
      } catch (error) {
        dispatch({
          type: 'snapshot_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }, [createFreshSession, loadSnapshot, studioKind])

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
    onRunStarted: (run) => {
      dispatch({
        type: 'run_started',
        run,
      })
    },
    onSnapshotLoaded: (snapshot) => {
      dispatch({
        type: 'snapshot_loaded',
        snapshot: {
          ...snapshot,
          runs: [...viewSelectors.selectStudioRuns(state), ...snapshot.runs],
        },
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

  const messages = viewSelectors.selectStudioMessages(state)
  const runs = viewSelectors.selectStudioRuns(state)
  const works = viewSelectors.selectStudioWorks(state)

  return {
    state,
    session: state.entities.session,
    messages,
    runs,
    works,
    latestRun: selectLatestRun(state),
    latestAssistantText: selectLatestAssistantText(state),
    isBusy: selectIsBusy(state),
    latestQuestion: state.runtime.latestQuestion,
    historyModal: {
      isOpen: isHistoryOpen,
      isLoading: isHistoryLoading,
      entries: historyEntries,
      currentSessionId: state.entities.session?.id ?? null,
      onClose: closeHistory,
      onSelectSession: async (targetSessionId: string) => {
        await restoreSession(targetSessionId, 'replace')
        setIsHistoryOpen(false)
      },
    },
    workSummaries: works.map((work) => ({
      work,
      latestTask: selectLatestTaskForWork(state, work.id),
      result: selectWorkSummary(state, work).result,
    })),
    openHistory,
    refresh,
    runCommand: async (inputText: string) => {
      await runCommand(inputText)
    },
    createNewSession: async () => {
      await createFreshSession('replace')
      void refreshHistory()
    },
    cancelCurrentRun: async (reason?: string) => {
      const activeRun = selectLatestRun(state)
      if (!activeRun || (activeRun.status !== 'pending' && activeRun.status !== 'running')) {
        return
      }

      await cancelStudioRun({
        runId: activeRun.id,
        reason,
      })

      dispatch({
        type: 'local_assistant_message',
        message: buildInterruptedAssistantMessage({
          sessionId: state.entities.session?.id ?? activeRun.sessionId,
          text: t('studio.interruptMessage'),
        }),
      })
    },
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

function buildInterruptedAssistantMessage(input: {
  sessionId: string
  text: string
}): StudioAssistantMessage {
  const timestamp = new Date().toISOString()
  const messageId = `local-interrupt-${timestamp}`

  return {
    id: messageId,
    sessionId: input.sessionId,
    role: 'assistant',
    agent: 'builder',
    createdAt: timestamp,
    updatedAt: timestamp,
    parts: [
      {
        id: `${messageId}-text`,
        messageId,
        sessionId: input.sessionId,
        type: 'text',
        text: input.text,
      },
    ],
  }
}

function getDefaultStudioTitle(studioKind: StudioKind, t: (key: 'studio.plotTitle' | 'studio.manimTitle') => string): string {
  return studioKind === 'plot' ? t('studio.plotTitle') : t('studio.manimTitle')
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

function buildHistoryEntry(snapshot: Awaited<ReturnType<typeof getStudioSessionSnapshot>>): StudioSessionHistoryEntry {
  const latestAssistantMessage = [...snapshot.messages].reverse().find((message) => message.role === 'assistant')
  const latestUserMessage = [...snapshot.messages].reverse().find((message) => message.role === 'user')

  return {
    id: snapshot.session.id,
    title: snapshot.session.title,
    studioKind: snapshot.session.studioKind ?? 'manim',
    updatedAt: snapshot.session.updatedAt,
    previewText: readHistoryPreviewText(latestAssistantMessage, latestUserMessage),
  }
}

function readHistoryPreviewText(
  latestAssistantMessage: StudioMessage | undefined,
  latestUserMessage: StudioMessage | undefined,
) {
  if (latestAssistantMessage?.role === 'assistant') {
    const textPart = latestAssistantMessage.parts.find((part) => part.type === 'text' || part.type === 'reasoning')
    if (textPart?.text.trim()) {
      return textPart.text.trim()
    }

    if (latestAssistantMessage.summary?.trim()) {
      return latestAssistantMessage.summary.trim()
    }
  }

  if (latestUserMessage?.role === 'user' && latestUserMessage.text.trim()) {
    return latestUserMessage.text.trim()
  }

  return 'No messages yet'
}
