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
import { CinemaScreen } from './CinemaScreen'
import {
  readStudioCinemaCatStatus,
  readStudioCinemaFeedbackKey,
  readStudioCinemaRenderStatusKey,
  readStudioCinemaRunStatusKey,
  readStudioCinemaScreenState,
  readStudioCinemaStreamStateKey,
  readStudioCinemaSubmitBlockedKey,
  type StudioCinemaScreenState,
} from './cinema-labels'
import { SceneActivity } from './SceneActivity'
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
  /** Test seam: partial overrides of the Session gateway (API and storage). */
  sessionOverrides?: Partial<StudioCinemaSessionGatewayDependencies>
  /** Test seam: partial overrides of the Scene controller dependencies. */
  controllerOverrides?: Partial<StudioCinemaControllerDependencies>
  /** Test seam: an in-memory Scene-selection store, so a spec can prove no global storage is used. */
  sceneSelectionStore?: StudioCinemaSceneSelectionStore
}

const STUDIO_KIND: StudioKind = 'manim'
const SCENE_PANEL_ID = 'cinema-scene-panel'
const HISTORY_PANEL_ID = 'cinema-scene-history'

/** From `lg` up the side column is in flow; below it the expanded sidebar is an overlay. */
function readInitialSidebarOpen(): boolean {
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
  sessionOverrides,
  controllerOverrides,
  sceneSelectionStore,
}: ManimCinemaWorkspaceProps) {
  const { t } = useI18n()
  const session = useStudioCinemaSession({
    studioKind: STUDIO_KIND,
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
  const catButtonRef = useRef<HTMLButtonElement | null>(null)
  const initializedSessionRef = useRef<string | null>(null)

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
    studioKind: STUDIO_KIND,
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
    (state.feedback ? readStudioCinemaFeedbackKey(state.feedback.code) : null)

  return (
    <div
      className={`flex h-screen min-h-0 flex-col overflow-hidden bg-bg-primary text-text-primary studio-shell-root ${
        isExiting ? 'animate-studio-exit' : 'animate-studio-entrance'
      }`}
    >
      <div className="relative flex min-h-0 flex-1">
        <SessionSidebar
          open={sidebarOpen}
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
          sceneLabel={t('studio.cinema.sceneLabel', { index: Math.max(0, sceneIndex) + 1 })}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 px-3 py-2">
            <h1 className="min-w-0 flex-1 truncate text-base font-medium text-text-primary/85">
              {t('studio.cinema.sceneLabel', { index: Math.max(0, sceneIndex) + 1 })}
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
            <button
              type="button"
              className="inline-flex min-h-[36px] items-center rounded-md border border-black/10 px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
              onClick={onExit}
              aria-label={t('studio.cinema.exit')}
            >
              {t('studio.cinema.exitShort')}
            </button>
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
                {t('studio.cinema.initializeProgress', {
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
                {t('studio.cinema.initializeContinue')}
              </button>
            </div>
          ) : null}

          <SceneStrip
            entries={index}
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

          <div className="relative flex min-h-0 flex-1 flex-col px-3 pb-2 sm:pr-28 lg:px-32">
            <div
              className="relative flex min-h-0 flex-1 items-center justify-center"
              role="tabpanel"
              id={SCENE_PANEL_ID}
            >
              {index.length === 0 ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-base text-text-primary/70">{t('studio.cinema.sceneEmptyTitle')}</p>
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
                    {t('studio.cinema.sceneCreateFirst')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex h-full min-h-0 w-full max-w-[1040px] items-center justify-center">
                    <CinemaScreen
                      state={screenState}
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

            {view !== null ? (
              <div
                className={`pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 transition-opacity duration-200 sm:right-5 lg:right-8 ${
                  historyOpen ? 'opacity-0' : 'opacity-100'
                }`}
              >
                <CatAssistant
                  statusKey={catStatus?.key ?? 'studio.cinema.catIdle'}
                  statusParams={catStatus?.params}
                  tone={catStatus?.tone ?? 'idle'}
                  sessionId={sessionId ?? ''}
                  sceneId={selectedSceneId ?? ''}
                  hasFailedOutcome={view?.userStatus.kind === 'failed'}
                  historyOpen={historyOpen}
                  historyPanelId={HISTORY_PANEL_ID}
                  buttonRef={catButtonRef}
                  onToggleHistory={toggleHistory}
                />
              </div>
            ) : null}
          </div>

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
                : view?.submitBlockReason
                  ? readStudioCinemaSubmitBlockedKey(view.submitBlockReason)
                  : null
            }
            onDraftChange={(text) => {
              if (view) {
                controller.setDraft(view.identity.sceneId, text)
              }
            }}
            onSubmit={() => {
              if (view && identityReady) {
                void controller.submitSceneRun(view.identity.sceneId)
              }
            }}
            onCancel={() => {
              if (view && identityReady) {
                void controller.cancelSceneRun(view.identity.sceneId)
              }
            }}
          />
        </main>

        <SceneHistoryPanel
          id={HISTORY_PANEL_ID}
          open={historyOpen && view !== null}
          sessionId={sessionId ?? ''}
          sceneId={selectedSceneId ?? ''}
          revision={conversationRevision}
          title={t('studio.cinema.historyTitle', { index: Math.max(0, sceneIndex) + 1 })}
          rows={rows}
          usage={view?.tokenUsage ?? null}
          loading={view?.snapshotStatus === 'loading' && isStudioCinemaConversationEmpty(rows)}
          onClose={closeHistory}
          catPose={
            catStatus?.tone === 'error'
              ? 'error'
              : catStatus?.tone === 'busy' || catStatus?.tone === 'warning'
                ? 'busy'
                : 'idle'
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <SceneActivity
          sceneIndex={Math.max(0, sceneIndex)}
          runStatusKey={view?.latestRun ? readStudioCinemaRunStatusKey(view.latestRun.status) : null}
          activeRunStartedAt={view?.activeRun?.createdAt ?? null}
          usage={view?.tokenUsage ?? null}
        />
      </div>
    </div>
  )
}
