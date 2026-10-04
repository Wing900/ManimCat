import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import type { StudioKind } from '../../protocol/studio-agent-types'
import { selectStudioCinemaSceneIndex, selectStudioCinemaSelectedSceneView } from '../scene-selectors'
import { useStudioCinema } from '../use-studio-cinema'
import type { StudioCinemaSessionGatewayDependencies } from '../session/studio-cinema-session-gateway'
import { useStudioCinemaSession, type StudioCinemaSessionFailure } from '../session/use-studio-cinema-session'
import type { StudioCinemaControllerDependencies } from '../cinema-controller'
import { CatAssistant } from './CatAssistant'
import { cinemaUnitKey } from './cinema-copy'
import { CinemaScreen } from './CinemaScreen'
import {
  readStudioCinemaCatStatus,
  readStudioCinemaFeedbackKey,
  readStudioCinemaRenderStatusKey,
  readStudioCinemaScreenState,
  readStudioCinemaStreamStateKey,
  readStudioCinemaSubmitBlockedKey,
  type StudioCinemaScreenState,
} from './cinema-labels'
import { SceneComposer } from './SceneComposer'
import { SceneHistoryPanel } from './SceneHistoryPanel'
import { SceneStrip } from './SceneStrip'
import { SessionSidebar } from './SessionSidebar'
import { isStudioCinemaConversationEmpty, readStudioCinemaConversationRows } from './scene-conversation-model'
import {
  isStudioCinemaIndexReadTarget,
  type StudioCinemaSceneSelectionStore,
} from './scene-selection-plan'
import { useStudioCinemaSceneSelection } from './use-studio-cinema-scene-selection'

/**
 * The Manim Cinema workspace (task 11C2): the real Manim Studio screen.
 *
 * Composition only. The Session identity comes from the narrow Session gateway, the Scene state from
 * the accepted Scene controller, and every component below consumes explicit view props — no network
 * call happens in a component and no second Scene reducer exists. The conversation history is a UI
 * state that is opened only by the cat; it changes neither the message store nor the controller.
 *
 * Two gates protect every Scene-targeted action (correction R2):
 *
 * - **identity ready**: the Session gateway is `ready` *and* the Session the controller owns is the
 *   one the gateway resolved. While a switch is pending the screen and the draft are kept, but send,
 *   stop, append and continue-initialize are closed — and each handler re-checks the gate, so a stale
 *   closure cannot fire a request at the Session that is being left.
 */

export interface ManimCinemaWorkspaceProps {
  onExit: () => void
  isExiting?: boolean
  /** Which studio kind this workspace drives (Session/Scene/Sidebar storage keys). */
  studioKind?: StudioKind
  /** The concept text the user typed on the home page; seeded into the first scene's draft on entry. */
  concept?: string
  /** Test seam: partial overrides of the Session gateway (API and storage). */
  sessionOverrides?: Partial<StudioCinemaSessionGatewayDependencies>
  /** Test seam: partial overrides of the Scene controller dependencies. */
  controllerOverrides?: Partial<StudioCinemaControllerDependencies>
  /** Test seam: an in-memory Scene-selection store, so a spec can prove no global storage is used. */
  sceneSelectionStore?: StudioCinemaSceneSelectionStore
}

const SCENE_PANEL_ID = 'cinema-scene-panel'
const HISTORY_PANEL_ID = 'cinema-scene-history'

/** From `lg` up the side column is in flow; below it the expanded sidebar is an overlay. */
function readInitialSidebarOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia('(min-width: 1024px)').matches
}

/** Desktop (lg+) renders the history panel as an in-flow sidebar; below lg it is a modal overlay. */
function readInitialDesktopViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia('(min-width: 1024px)').matches
}

/** Only a definite "this entry is gone" failure may be reported as removed. */
function readSessionFailureKey(failure: StudioCinemaSessionFailure | null): TranslationKey | null {
  switch (failure) {
    case null:
      return null
    case 'restore_unavailable':
      return 'studio.cinema.feedbackSessionUnavailable'
    case 'restore_missing':
      return 'studio.cinema.feedbackSessionMissing'
    case 'create_failed':
      return 'studio.cinema.feedbackSessionCreateFailed'
    case 'create_unknown':
      return 'studio.cinema.feedbackSessionCreateUnknown'
    case 'unexpected':
      return 'studio.cinema.feedbackSessionUnavailable'
  }
}

export function ManimCinemaWorkspace({
  onExit,
  isExiting = false,
  studioKind = 'manim',
  concept,
  sessionOverrides,
  controllerOverrides,
  sceneSelectionStore,
}: ManimCinemaWorkspaceProps) {
  const { t } = useI18n()
  const session = useStudioCinemaSession({
    studioKind,
    ...(sessionOverrides ? { overrides: sessionOverrides } : {}),
  })
  const { state, controller } = useStudioCinema({
    session: session.session,
    ...(controllerOverrides ? { overrides: controllerOverrides } : {}),
  })

  // A narrow viewport starts with the rail, so an overlay never covers the screen on first paint.
  // One initial media query, no resize listener and no polling; from `lg` up the side column is real.
  const [sidebarOpen, setSidebarOpen] = useState(readInitialSidebarOpen)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [isDesktopViewport, setIsDesktopViewport] = useState(readInitialDesktopViewport)
  const catButtonRef = useRef<HTMLButtonElement | null>(null)
  const initializedSessionRef = useRef<string | null>(null)

  // Carry the home-page concept into the first Scene's draft, once. Only seeds an empty draft, so a
  // restored Session (which already has its own draft) or a user edit is never overwritten.
  const conceptSeededRef = useRef(false)
  useEffect(() => {
    if (conceptSeededRef.current) return
    if (!concept || concept.trim().length === 0) return
    const sceneId = state.selectedSceneId
    if (!sceneId) return
    const scene = state.scenes[sceneId]
    if (!scene) return
    conceptSeededRef.current = true
    if (!scene.draft || scene.draft.trim().length === 0) {
      controller.setDraft(sceneId, concept)
    }
  }, [concept, state.selectedSceneId, state.scenes, controller])

  // One matchMedia listener (not a window resize listener) tracks whether the history panel renders
  // as an in-flow sidebar (lg+) or a modal overlay (below lg). Doc §8: semantics match the layout.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const query = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktopViewport(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const index = useMemo(() => selectStudioCinemaSceneIndex(state), [state])
  const view = useMemo(() => selectStudioCinemaSelectedSceneView(state), [state])
  const sceneIndex = index.findIndex((entry) => entry.isSelected)
  const selectedSceneId = state.selectedSceneId

  const sessionId = state.session.id
  // Correction R2: a Scene-targeted mutation needs the *resolved* Session to be the one the
  // controller owns. While a switch is pending the old screen stays, but it is not actionable.
  const identityReady =
    session.status === 'ready' && session.session !== null && sessionId === session.session.id

  // Correction F1: these inputs keep a stable identity across renders (and the binding reads them
  // through refs anyway), so a re-render can never restart the index read or cancel a resolved one.
  const selectScene = useCallback((sceneId: string) => controller.selectScene(sceneId), [controller])
  const indexSceneIds = useMemo(() => index.map((entry) => entry.id), [index])
  const readSceneIndex = useCallback(
    (expectedSessionId: string): Promise<'ok' | 'failed' | 'stale'> => {
      // The signature promises one Session; the read is refused, without a request, when the controller
      // no longer owns it.
      if (
        !isStudioCinemaIndexReadTarget({
          controllerSessionId: controller.getState().session.id,
          expectedSessionId,
        })
      ) {
        return Promise.resolve('stale')
      }
      return controller.loadSceneIndex()
    },
    [controller],
  )

  const selection = useStudioCinemaSceneSelection({
    studioKind,
    sessionId,
    indexSceneIds,
    currentSelection: selectedSceneId,
    selectScene,
    readIndex: readSceneIndex,
    ...(sceneSelectionStore ? { store: sceneSelectionStore } : {}),
  })

  // Scenes are created exactly once, and only for the Session this workspace created itself: a
  // restored Session is never back-filled with new Scenes.
  useEffect(() => {
    const sessionId = session.origin === 'created' ? session.session?.id ?? null : null
    if (!sessionId || initializedSessionRef.current === sessionId) {
      return
    }
    initializedSessionRef.current = sessionId
    void controller.initializeScenes()
  }, [controller, session.origin, session.session?.id])

  const closeHistory = useCallback(() => {
    setHistoryOpen(false)
    // The cat owns the toggle, so closing returns the focus where the user left it.
    catButtonRef.current?.focus()
  }, [])

  const toggleHistory = useCallback(() => {
    setHistoryOpen((open) => !open)
  }, [])

  const rows = useMemo(
    () => (view ? readStudioCinemaConversationRows(view.messages) : []),
    [view],
  )

  // The only thing the cat is allowed to say: the newest assistant message of this Scene. The bubble
  // repeats its opening; when there is none the cat stays quiet instead of reciting a written line.
  const latestReply = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row.kind === 'assistant-text') {
        return { id: row.id, text: row.text }
      }
    }
    return null
  }, [rows])

  // While a Run is in flight and this Scene has not answered for it yet, the cat types. The marker is
  // structural — the newest row is a user message with no assistant message after it — so a reply that
  // already belongs to this Run keeps its own bubble instead of being masked by a typing indicator.
  const pendingReply = useMemo(() => {
    if (!view) {
      return false
    }
    const runStatus = view.latestRun?.status ?? null
    const runInFlight = view.submitting || runStatus === 'pending' || runStatus === 'running'
    if (!runInFlight) {
      return false
    }
    const kinds = rows.map((row) => row.kind)
    return kinds.lastIndexOf('user') > kinds.lastIndexOf('assistant-text')
  }, [rows, view])

  // Correction R3: the scroll follow must see content growth, not only a new row count — a streaming
  // assistant part keeps the row count and changes only its text.
  const conversationRevision = useMemo(
    () =>
      rows
        .map((row) => `${row.id}:${row.kind === 'tool' ? row.status : row.text.length}`)
        .join('|'),
    [rows],
  )

  const catStatus = view
    ? readStudioCinemaCatStatus({
        studioKind,
        sceneIndex: Math.max(0, sceneIndex),
        submitting: view.submitting,
        hasActiveRun: view.activeRun !== null,
        hasActiveRender: view.activeRender !== null,
        needsReconciliation: view.needsReconciliation,
        snapshotStatus: view.snapshotStatus,
        streamState: view.streamState,
        renderRefresh: view.renderRefresh,
        hasFailedOutcome: view.userStatus.kind === 'failed',
      })
    : null

  const screenState: StudioCinemaScreenState = view
    ? readStudioCinemaScreenState({
        playableUrl: view.display.playableUrl,
        capabilityGap: view.display.capabilityGap,
        hasActiveRender: view.activeRender !== null,
        latestStatus: view.display.latestStatus,
      })
    : 'empty'

  const sessionFeedbackKey =
    readSessionFailureKey(session.failure) ??
    (state.feedback ? readStudioCinemaFeedbackKey(studioKind, state.feedback.code) : null)

  return (
    <div
      className={`flex h-screen min-h-0 flex-col overflow-hidden bg-bg-primary text-text-primary studio-shell-root ${
        isExiting ? 'animate-studio-exit' : 'animate-studio-entrance'
      }`}
    >
      <div className="relative flex min-h-0 flex-1">
        <SessionSidebar
          open={sidebarOpen}
          studioKind={studioKind}
          onToggle={() => setSidebarOpen((open) => !open)}
          currentSessionId={state.session.id}
          currentTitle={state.session.title ?? t('studio.cinema.sessionTitle')}
          historyIds={session.historyIds}
          status={session.status}
          feedbackKey={sessionFeedbackKey}
          onCreate={session.createNewSession}
          onRetry={session.retry}
          onSelectSession={session.selectSession}
          tokenUsage={view?.tokenUsage ?? null}
          sentRounds={view?.messages.filter((message) => message.role === 'user').length ?? 0}
          sceneLabel={t(cinemaUnitKey(studioKind, 'sceneLabel'), { index: Math.max(0, sceneIndex) + 1 })}
          onExit={onExit}
        />

        <main
          className="relative flex min-w-0 flex-1 flex-col"
          inert={historyOpen && !isDesktopViewport ? true : undefined}
        >
          <header data-assemble="header" className="flex items-center gap-2 px-3 py-2">
            <h1 className="min-w-0 flex-1 truncate text-base font-medium text-text-primary/85">
              {t(cinemaUnitKey(studioKind, 'sceneLabel'), { index: Math.max(0, sceneIndex) + 1 })}
            </h1>
            {session.status === 'loading' && session.session !== null ? (
              <span
                role="status"
                className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm text-amber-700 dark:text-amber-300"
              >
                {t('studio.cinema.sessionSwitching')}
              </span>
            ) : null}
            {view && view.streamState !== 'connected' ? (
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-sm text-text-secondary/70 dark:bg-white/10">
                {t(readStudioCinemaStreamStateKey(view.streamState))}
              </span>
            ) : null}
          </header>

          {selection.indexFailed ? (
            <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
              <p className="min-w-0 flex-1 text-sm text-amber-700 dark:text-amber-300">
                {t('studio.cinema.indexUnavailable')}
              </p>
              <button
                type="button"
                className="inline-flex min-h-[36px] shrink-0 items-center rounded-md border border-amber-500/40 px-2.5 text-sm text-amber-700 dark:text-amber-300"
                onClick={selection.retryIndex}
              >
                {t('studio.cinema.indexRetry')}
              </button>
            </div>
          ) : null}

          {state.initialization.status === 'partial' || state.initialization.status === 'failed' ? (
            <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
              <p className="min-w-0 flex-1 text-sm text-amber-700 dark:text-amber-300">
                {t(cinemaUnitKey(studioKind, 'initializeProgress'), {
                  created: state.initialization.createdCount,
                  target: state.initialization.targetCount,
                })}
              </p>
              <button
                type="button"
                className="inline-flex min-h-[36px] shrink-0 items-center rounded-md border border-amber-500/40 px-2.5 text-sm text-amber-700 dark:text-amber-300"
                disabled={!identityReady}
                onClick={() => {
                  if (identityReady) {
                    void controller.continueSceneInitialization()
                  }
                }}
              >
                {t(cinemaUnitKey(studioKind, 'initializeContinue'))}
              </button>
            </div>
          ) : null}

          <div data-assemble="strip">
            <SceneStrip
              entries={index}
              studioKind={studioKind}
              mutationPending={state.sceneMutationPending || !identityReady}
              panelId={SCENE_PANEL_ID}
              onSelect={(sceneId) => {
                if (sceneId !== state.selectedSceneId) {
                  controller.selectScene(sceneId)
                }
              }}
              onAppend={() => {
                if (identityReady) {
                  void controller.appendScene()
                }
              }}
            />
          </div>

          <div data-assemble="stage" className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 pb-3 sm:px-20 lg:px-32">
            <div
              className="relative flex min-h-0 w-full flex-1 items-center justify-center"
              role="tabpanel"
              id={SCENE_PANEL_ID}
            >
              {index.length === 0 ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-base text-text-primary/70">{t(cinemaUnitKey(studioKind, 'sceneEmptyTitle'))}</p>
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] items-center rounded-lg border border-black/10 px-3 text-sm disabled:opacity-40 dark:border-white/15"
                    disabled={state.sceneMutationPending || !identityReady}
                    onClick={() => {
                      if (identityReady) {
                        void controller.appendScene()
                      }
                    }}
                  >
                    {t(cinemaUnitKey(studioKind, 'sceneCreateFirst'))}
                  </button>
                </div>
              ) : (
                <>
                  <div
                    className={
                      // A result keeps its own aspect ratio and only borrows the slot's bounds; the dark
                      // 16:9 stage is the shape of "nothing to show", not of the media.
                      screenState === 'playable'
                        ? 'flex h-full max-h-full min-h-0 w-full max-w-[1040px] items-center justify-center'
                        : 'aspect-video max-h-full w-full max-w-[1040px]'
                    }
                  >
                    <CinemaScreen
                      state={screenState}
                      studioKind={studioKind}
                      sceneIndex={Math.max(0, sceneIndex)}
                      playableUrl={view?.display.playableUrl ?? null}
                      mediaKind={view?.display.mediaKind ?? null}
                      hasNewerWorkBehindResult={
                        screenState === 'playable' &&
                        (view?.activeRender !== null || view?.userStatus.kind === 'failed')
                      }
                      activeRenderStatusKey={
                        view?.activeRender ? readStudioCinemaRenderStatusKey(view.activeRender.status) : null
                      }
                      refreshPausedReasonKey={
                        view?.renderRefresh.pauseReason === 'failures'
                          ? 'studio.cinema.renderRefreshPausedFailures'
                          : view?.renderRefresh.pauseReason === 'budget'
                            ? 'studio.cinema.renderRefreshPausedBudget'
                            : null
                      }
                      onResumeRefresh={() => {
                        if (view && identityReady) {
                          controller.resumeSceneRenderRefresh(view.identity.sceneId)
                        }
                      }}
                      onReconcile={() => {
                        if (view && identityReady) {
                          void controller.reconcileScene(view.identity.sceneId)
                        }
                      }}
                    />
                  </div>
                </>
              )}
            </div>
            </div>
          </div>

          <div data-assemble="composer" className="relative px-3 pb-16 sm:px-20 sm:pb-4 lg:px-32">
          {/* The cat stands at the bottom-right, under the video — never at its left or right flank. From sm
              up the wrapper's padding already clears the input box; on phones (full-width input) the band
              reserves bottom room so the cat drops below the input instead of sitting on it. */}
          {view !== null ? (
            <div
              className={`pointer-events-none absolute bottom-1 right-3 z-10 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] sm:bottom-2 sm:right-4 lg:right-6 ${
                historyOpen ? 'translate-x-12 -translate-y-6 opacity-0' : 'opacity-100'
              }`}
            >
              <CatAssistant
                studioKind={studioKind}
                statusKey={catStatus?.key ?? 'studio.cinema.catIdle'}
                statusParams={catStatus?.params}
                tone={catStatus?.tone ?? 'idle'}
                sessionId={sessionId ?? ''}
                sceneId={selectedSceneId ?? ''}
                latestRunStatus={view?.latestRun?.status ?? null}
                reply={latestReply}
                pendingReply={pendingReply}
                historyOpen={historyOpen}
                historyPanelId={HISTORY_PANEL_ID}
                buttonRef={catButtonRef}
                onToggleHistory={toggleHistory}
              />
            </div>
          ) : null}

          <SceneComposer
            draft={view?.draft ?? ''}
            submitting={view?.submitting ?? false}
            canSubmit={identityReady && (view?.canSubmit ?? false)}
            canCancel={identityReady && (view?.canCancel ?? false)}
            blockedReasonKey={
              !identityReady
                ? session.status === 'loading'
                  ? 'studio.cinema.submitBlockedSessionSwitching'
                  : null
                : view?.submitBlockReason &&
                    view.submitBlockReason !== 'empty_draft' &&
                    // A running task is reported by the composer's own status line (`任务进行中…`), so
                    // the extra "you can stop it" sentence is gone.
                    view.submitBlockReason !== 'active_run'
                  ? readStudioCinemaSubmitBlockedKey(studioKind, view.submitBlockReason)
                  : null
            }
            onDraftChange={(text) => {
              if (view) {
                controller.setDraft(view.identity.sceneId, text)
              }
            }}
            onSubmit={(inputTextOverride) => {
              if (view && identityReady) {
                void controller.submitSceneRun(view.identity.sceneId, inputTextOverride)
              }
            }}
            onCancel={() => {
              if (view && identityReady) {
                void controller.cancelSceneRun(view.identity.sceneId)
              }
            }}
          />
          </div>
        </main>

        <SceneHistoryPanel
          id={HISTORY_PANEL_ID}
          open={historyOpen && view !== null}
          sessionId={sessionId ?? ''}
          sceneId={selectedSceneId ?? ''}
          revision={conversationRevision}
          title={t(cinemaUnitKey(studioKind, 'historyTitle'), { index: Math.max(0, sceneIndex) + 1 })}
          rows={rows}
          loading={view?.snapshotStatus === 'loading' && isStudioCinemaConversationEmpty(rows)}
          pendingReply={
            view !== null &&
            view.activeRun !== null &&
            (rows.length === 0 || rows[rows.length - 1].kind === 'user')
          }
          onClose={closeHistory}
          modal={!isDesktopViewport}
          catPose={
            catStatus?.tone === 'error'
              ? 'error'
              : catStatus?.tone === 'busy' || catStatus?.tone === 'warning'
                ? 'busy'
                : 'idle'
          }
        />
      </div>
    </div>
  )
}
