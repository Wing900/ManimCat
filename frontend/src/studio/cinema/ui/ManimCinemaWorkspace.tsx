import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  readStudioCinemaScreenState,
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
import { useStudioCinemaSceneSelection, STUDIO_CINEMA_SCENE_SELECTION_STORE } from './use-studio-cinema-scene-selection'
import { useStudioCinemaContentSlide, type StudioCinemaContentPosition } from './use-content-slide'
import { useLeavingCard } from './use-leaving-card'

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
/** The content slide of doc §3.1, in milliseconds — kept in step with the `content-*` animations in index.css. */
const CONTENT_SLIDE_MS = 420
// A little past the slide, so an exit that has started is never cut off by its own removal.
const EXIT_CARD_MS = 440

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

  const stateView = useMemo(() => selectStudioCinemaSelectedSceneView(state), [state])
  const lastViewRef = useRef<ReturnType<typeof selectStudioCinemaSelectedSceneView>>(null)
  useLayoutEffect(() => {
    if (stateView) {
      lastViewRef.current = stateView
    }
  }, [stateView])
  // The card on stage is held while the next one is unresolved, whoever it belonged to. It cannot be
  // dropped because the Session changed: the card that is leaving has to stay *the same DOM* (see
  // `useLeavingCard`), and a hole in between is exactly what unmounts the media that is still on screen.
  // A Session always ends up with a Scene (creation targets at least one), so the hold ends by itself.
  const view = stateView ?? lastViewRef.current
  const sceneIndex = index.findIndex((entry) => entry.isSelected)
  const selectedSceneId = state.selectedSceneId

  // Which way the content is moving: a different Session is a different card (vertical), a different
  // Scene inside the same Session is a different page of it (horizontal). The direction follows the
  // list order, so switching down a list reads like scrolling a feed.
  // The slide hook must only ever see resolved cards. A view that is momentarily unresolved is not a
  // destination — the user chose nothing — and letting it through clears the memory of where the stage
  // was, so the real change that follows reads as "no movement" and the push is lost (and the transient
  // empty card would be pushed as if it were a Session).
  const resolvedPositionRef = useRef<StudioCinemaContentPosition | null>(null)
  const position: StudioCinemaContentPosition = {
    sessionId: view?.identity.sessionId ?? null,
    sceneId: view?.identity.sceneId ?? null,
    sessionOrder: view ? session.historyIds.indexOf(view.identity.sessionId) : -1,
    sceneOrder: view ? index.findIndex((entry) => entry.id === view.identity.sceneId) : -1,
  }
  if (view !== null) {
    resolvedPositionRef.current = position
  }
  const contentSlide = useStudioCinemaContentSlide(resolvedPositionRef.current ?? position)
  // The card this render is showing (null while the view is unresolved).
  const destinationKey = view ? `${view.identity.sessionId}\u0000${view.identity.sceneId}` : null
  // Motion answers the user's own action. `intentRef` is armed by every switch the user makes (a Scene
  // tab, a Session row, a new Session) and consumed by the card that answers it, so the arrivals that
  // are not the user's doing — a Session settling, the index landing, the second half of a card that is
  // still filling in — are placed without motion.
  const intentRef = useRef<
    { kind: 'scene'; sceneId: string } | { kind: 'session'; sessionId: string } | { kind: 'new-session'; from: string | null } | null
  >(null)
  const userIntent = intentRef.current
  const intentMatches =
    userIntent !== null &&
    view !== null &&
    (userIntent.kind === 'scene'
      ? view.identity.sceneId === userIntent.sceneId
      : userIntent.kind === 'session'
        ? view.identity.sessionId === userIntent.sessionId
        : // A new Session cannot be named in advance, and it must not be a plain wildcard: the card on
          // stage is still the *previous* Session's, so a wildcard would match it, spend the intent a
          // render before the new card exists, and leave the arrival to be animated by whatever else
          // happens to arm an intent — which is exactly what it used to do. Any Session other than the
          // one that was on screen is the card this answers.
          view.identity.sessionId !== userIntent.from)
  // A slide that is still running toward another card is not restarted. A CSS keyframe animation cannot
  // be interrupted: it jumps back to the far edge, and the card that was leaving is replaced mid-flight
  // — the pile of half-moved cards that fast scrubbing looks like today. The content still changes; what
  // coalesces is the motion.
  const lastSlideAtRef = useRef(Number.NEGATIVE_INFINITY)
  const slideInFlight =
    contentSlide.axis !== null && performance.now() - lastSlideAtRef.current < CONTENT_SLIDE_MS
  const animatePush = contentSlide.axis !== null && intentMatches && !slideInFlight
  const push = animatePush ? contentSlide : { axis: null, direction: contentSlide.direction }
  useLayoutEffect(() => {
    if (intentMatches) {
      intentRef.current = null
    }
    if (animatePush) {
      lastSlideAtRef.current = performance.now()
    }
  })
  // Distinct keys per sibling: React requires unique keys among the children of one parent, and both
  // must change on the same frame so the animations stay in step.
  const contentKey = view ? `${view.identity.sessionId}\u0000${view.identity.sceneId}` : 'studio-empty'
  // A push, not a swap: the arriving card enters from its side and the leaving card exits the other
  // way. Both classes are resolved in this same render, so the two animations stay in step.
  const slideForward = push.direction === 'forward'
  const stageSlideClass =
    push.axis === 'scene'
      ? slideForward
        ? 'studio-content-from-right'
        : 'studio-content-from-left'
      : push.axis === 'session'
        ? slideForward
          ? 'studio-content-rise'
          : 'studio-content-fall'
        : ''
  const stageExitClass =
    push.axis === 'scene'
      ? slideForward
        ? 'studio-content-to-left'
        : 'studio-content-to-right'
      : push.axis === 'session'
        ? slideForward
          ? 'studio-content-rise-out'
          : 'studio-content-fall-out'
        : ''
  // The strip only follows a Session: inside one Session the tab row is the control the Scene is
  // picked from, so it stays put and the screen is what turns.
  const sessionSlideClass =
    push.axis === 'session'
      ? slideForward
        ? 'studio-content-rise'
        : 'studio-content-fall'
      : ''
  const sessionKey = view?.identity.sessionId ?? 'studio-empty'
  // A push belongs to the *card*, not to the render: it is latched when a new destination appears and
  // then held, because a live update (a media load, a stream event, the card filling in) re-renders, and
  // a class recomputed from the live signal would drop the running animation halfway. A destination that
  // is not animated is latched as such, so fast input never leaves a stale slide behind.
  const pushRef = useRef({ destination: null as string | null, animated: false, enter: '', exit: '', strip: '' })
  if (pushRef.current.destination !== destinationKey) {
    pushRef.current = {
      destination: destinationKey,
      animated: animatePush,
      enter: stageSlideClass,
      exit: stageExitClass,
      strip: sessionSlideClass,
    }
  }
  const pushState = pushRef.current

  const sessionId = state.session.id
  // Correction R2: a Scene-targeted mutation needs the *resolved* Session to be the one the
  // controller owns. While a switch is pending the old screen stays, but it is not actionable.
  const identityReady =
    session.status === 'ready' && session.session !== null && sessionId === session.session.id

  // Correction F1: these inputs keep a stable identity across renders (and the binding reads them
  // through refs anyway), so a re-render can never restart the index read or cancel a resolved one.
  const selectScene = useCallback(
    (sceneId: string) => {
      // The user asked for this Scene: the card that answers it is the one that slides.
      intentRef.current = { kind: 'scene', sceneId }
      controller.selectScene(sceneId)
    },
    [controller],
  )
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

  // Where a Session's Scene choice lives. Deleting a Session clears its entry too, so the two must write
  // the same store — the store a caller brought, or the browser's localStorage.
  const selectionStore = sceneSelectionStore ?? STUDIO_CINEMA_SCENE_SELECTION_STORE
  const selection = useStudioCinemaSceneSelection({
    studioKind,
    sessionId,
    indexSceneIds,
    currentSelection: selectedSceneId,
    selectScene,
    readIndex: readSceneIndex,
    store: selectionStore,
  })

  // Scenes are created exactly once per Session: for the one this workspace created, and for any
  // Session that turns out to have none at all — an empty Session fills itself to the default count
  // instead of showing a first-step screen of its own. A restored Session that already has Scenes is
  // never back-filled, and the trigger is a *readable* index: an unreadable one must not invent them.
  useEffect(() => {
    const createdId = session.origin === 'created' ? session.session?.id ?? null : null
    const emptyId = selection.indexReadable && index.length === 0 ? session.session?.id ?? null : null
    const sessionId = createdId ?? emptyId
    if (!sessionId || initializedSessionRef.current === sessionId) {
      return
    }
    initializedSessionRef.current = sessionId
    void controller.initializeScenes()
  }, [controller, index.length, selection.indexReadable, session.origin, session.session?.id])

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

  // A Run is in flight from the moment the request leaves until the Run itself stops: `submitting`
  // covers the window before the Run exists, then the Run's own status takes over. Another reply may
  // still arrive for as long as that holds, so the indicator belongs to the Run rather than to the
  // first answer it happens to produce.
  const runInFlight = useMemo(() => {
    if (!view) {
      return false
    }
    const runStatus = view.latestRun?.status ?? null
    return view.submitting || runStatus === 'pending' || runStatus === 'running'
  }, [view])

  // What the cat may repeat while the Run is in flight is only what this Run itself has said: a text
  // part that lands after the user message that started it. A reply from an earlier Run sits before
  // that message, so the cat never repeats it as though it were news.
  const runReply = useMemo(() => {
    if (!runInFlight) {
      return latestReply
    }
    const lastUserIndex = rows.reduce((found, row, index) => (row.kind === 'user' ? index : found), -1)
    for (let index = rows.length - 1; index > lastUserIndex; index -= 1) {
      const row = rows[index]
      if (row.kind === 'assistant-text') {
        return { id: row.id, text: row.text }
      }
    }
    return null
  }, [latestReply, rows, runInFlight])

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

  const sessionFeedbackKey =
    readSessionFailureKey(session.failure) ??
    (state.feedback ? readStudioCinemaFeedbackKey(studioKind, state.feedback.code) : null)

  // One card of the stage: the Scene's screen, or the "no Scenes yet" first step. Built as a plain
  // element so a card that is leaving can be rendered again from the previous one — a React element is
  // an immutable description, so re-rendering it re-creates the frame it had, values and all.
  const renderStageCard = (cardView: ReturnType<typeof selectStudioCinemaSelectedSceneView>, cardSceneIndex: number) => {
    const cardScreenState: StudioCinemaScreenState = cardView
      ? readStudioCinemaScreenState({
          playableUrl: cardView.display.playableUrl,
          capabilityGap: cardView.display.capabilityGap,
          hasActiveRender: cardView.activeRender !== null,
          latestStatus: cardView.display.latestStatus,
        })
      : 'empty'
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 pb-3 sm:px-20 lg:px-32">
        <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
          {/* No "this Session has no Scenes yet" first step: an empty Session fills itself (see the
              initialization effect above), and that screen was the one fully white frame on a light
              page — a page-coloured hole with text on it. A card without a view is simply the dark
              stage, the same surface as "no result yet". */}
          <div
            className={
              // A result keeps its own aspect ratio and only borrows the slot's bounds; the dark
              // 16:9 stage is the shape of "nothing to show", not of the media.
              cardScreenState === 'playable'
                ? 'flex h-full max-h-full min-h-0 w-full max-w-[1040px] items-center justify-center'
                : 'aspect-video max-h-full w-full max-w-[1040px]'
            }
          >
            <CinemaScreen
              state={cardScreenState}
              studioKind={studioKind}
              sceneIndex={Math.max(0, cardSceneIndex)}
              playableUrl={cardView?.display.playableUrl ?? null}
              fallbackVideoUrl={cardView?.display.fallbackVideoUrl}
              mediaKind={cardView?.display.mediaKind ?? null}
              refreshPausedReasonKey={
                cardView?.renderRefresh.pauseReason === 'failures'
                  ? 'studio.cinema.renderRefreshPausedFailures'
                  : cardView?.renderRefresh.pauseReason === 'budget'
                    ? 'studio.cinema.renderRefreshPausedBudget'
                    : null
              }
              onResumeRefresh={() => {
                if (cardView && identityReady) {
                  controller.resumeSceneRenderRefresh(cardView.identity.sceneId)
                }
              }}
              onReconcile={() => {
                if (cardView && identityReady) {
                  void controller.reconcileScene(cardView.identity.sceneId)
                }
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  // The two cards the stage can hold, both keyed by destination. That key is the mechanism: React keeps
  // the DOM of a keyed item, so the card that is leaving is still the very element — down to the pixels
  // a `<video>` was showing — that was on screen a moment ago. The arriving card is a new key, which is
  // what starts its slide; a key that does not change reuses the element, so a scrub neither restarts
  // the animation nor re-mounts the media.
  const liveCard = view
    ? { key: `${view.identity.sessionId}\u0000${view.identity.sceneId}`, view, sceneIndex }
    : null
  const leavingCard = useLeavingCard(liveCard, pushState.animated, EXIT_CARD_MS)

  return (
    <div
      className={`flex h-screen min-h-0 flex-col overflow-hidden bg-bg-primary text-text-primary studio-shell-root ${
        // The entry is owned by App's `page-assemble` (the parts assemble in a stagger). A second
        // entrance here would run a 1.8s blur over the whole shell on top of it.
        isExiting ? 'animate-studio-exit' : ''
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
          feedbackKey={sessionFeedbackKey}
          onCreate={() => {
            intentRef.current = { kind: 'new-session', from: state.session.id }
            session.createNewSession()
          }}
          onRetry={session.retry}
          onSelectSession={(sessionId) => {
            intentRef.current = { kind: 'session', sessionId }
            session.selectSession(sessionId)
          }}
          onDeleteSession={async (sessionId) => {
            // Deleting the Session that is on screen moves the stage to the one that takes its place: that
            // is also a switch the user asked for, so it gets the same card motion.
            if (sessionId === state.session.id) {
              intentRef.current = { kind: 'new-session', from: state.session.id }
            }
            // The server removes it first; only a real delete touches the local list.
            if (await session.forgetSession(sessionId)) {
              // The stored Scene choice of a Session that is gone goes with it.
              selectionStore.write(studioKind, sessionId, null)
            }
          }}
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
            <h1
              key={`${contentKey}-title`}
              className="studio-fade-in min-w-0 flex-1 truncate text-base font-medium text-text-primary/85"
            >
              {t(cinemaUnitKey(studioKind, 'sceneLabel'), { index: Math.max(0, sceneIndex) + 1 })}
            </h1>
            {session.status === 'loading' && session.session !== null ? (
              // sr-only on purpose: a switch is a frame or two long, and an amber chip for it is noise
              // on top of the stage. The state is still announced — and the composer below still says
              // why its send button is closed.
              <span role="status" className="sr-only">
                {t('studio.cinema.sessionSwitching')}
              </span>
            ) : null}
          </header>

          {/* Both banners stay mounted and collapse to zero height, so they slide open instead of
              shoving the stage down. */}
          <div className="studio-collapse" data-open={selection.indexFailed ? 'true' : 'false'}>
            <div>
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
            </div>
          </div>

          <div
            className="studio-collapse"
            data-open={
              state.initialization.status === 'partial' || state.initialization.status === 'failed'
                ? 'true'
                : 'false'
            }
          >
            <div>
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
            </div>
          </div>

          {/* The strip follows a Session switch — a new Session is a whole new set of Scenes. Inside one
              Session it does not move: the tab row is the control, the stage is what turns. */}
          <div key={`${sessionKey}-strip`} data-assemble="strip" className={pushState.strip}>
            <SceneStrip
              entries={index}
              studioKind={studioKind}
              mutationPending={state.sceneMutationPending || !identityReady}
              panelId={SCENE_PANEL_ID}
              onSelect={(sceneId) => {
                if (sceneId !== state.selectedSceneId) {
                  selectScene(sceneId)
                }
              }}
              onAppend={() => {
                if (identityReady) {
                  void controller.appendScene()
                }
              }}
            />
          </div>

          <div data-assemble="stage" className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* The card that is leaving keeps its own DOM — the same keyed item, still mounted — and
                slides out the other way, so both cards move together and the picture that was on screen
                stays on screen: a `<video>` that is kept is a video that keeps its frame. It is inert
                and hidden from assistive tech: to a screen reader it is already gone. */}
            {leavingCard ? (
              <div
                key={leavingCard.key}
                data-leaving="true"
                aria-hidden
                inert
                className={`pointer-events-none absolute inset-0 flex min-h-0 flex-col ${pushState.exit}`}
              >
                {renderStageCard(leavingCard.view, leavingCard.sceneIndex)}
              </div>
            ) : null}

            {/* The arriving card is keyed by destination: the key is what starts the slide. */}
            {liveCard ? (
              <div
                key={liveCard.key}
                role="tabpanel"
                id={SCENE_PANEL_ID}
                className={`flex min-h-0 flex-1 flex-col ${pushState.enter}`}
              >
                {renderStageCard(liveCard.view, liveCard.sceneIndex)}
              </div>
            ) : null}
          </div>

          <div data-assemble="composer" className="relative px-3 pb-16 sm:px-20 sm:pb-4 lg:px-32">
          {/* The cat stands at the bottom-right, under the video — never at its left or right flank. From sm
              up the wrapper's padding already clears the input box; on phones (full-width input) the band
              reserves bottom room so the cat drops below the input instead of sitting on it. */}
          {view !== null ? (
            <div
              className={`pointer-events-none absolute bottom-1 right-3 z-10 transition-all duration-300 ease-spring sm:bottom-2 sm:right-4 lg:right-6 ${
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
                reply={runReply}
                pendingReply={runInFlight}
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
            quietBlockedReason={!identityReady && session.status === 'loading'}
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
          // The same Run marker as the cat's: the conversation says the Run is still working even
          // though its reply has already landed, because another one may still be on its way.
          pendingReply={runInFlight}
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
