import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import ManimCatLogo from '../../../components/ManimCatLogo'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon } from './CinemaIcons'
import type { StudioKind, StudioTokenUsage } from '../../protocol/studio-agent-types'
import { LogoUsagePopover } from './LogoUsagePopover'
import { scrollIntoViewSoftly } from './scroll-into-view'
import { usePresence } from './use-presence'

/**
 * Session sidebar (task 11C2, doc §4).
 *
 * The list is exactly the local recent Session ids: there is no cloud-wide history endpoint, and the
 * sidebar never claims one. A Session whose restore failed stays listed (a temporary outage is not a
 * deleted Session); only a definite 404 answer removes an entry.
 *
 * Layout (correction R4): below `lg` the expanded sidebar floats over the screen with a backdrop
 * instead of taking width away from the video and the composer; from `lg` up it is an in-flow column
 * again. Pure CSS breakpoints — no window listener, no resize polling.
 *
 * Doc §2/§4: regular text 16px, auxiliary ≥14px, click targets ≥44×44px, expanded width 240px. Long
 * titles truncate but expose their full text through a native `title` so they are still viewable.
 */

/** The row's own fade + height collapse, then the list is told it is gone. */
const ROW_REMOVE_MS = 220
/** Long enough for the dialog's fade-out, short enough not to feel stuck. */
const DELETE_DIALOG_EXIT_MS = 160

export interface SessionSidebarProps {
  open: boolean
  onToggle: () => void
  currentSessionId: string | null
  currentTitle: string
  historyIds: readonly string[]
  feedbackKey: TranslationKey | null
  onCreate: () => void
  onRetry: () => void
  onSelectSession: (sessionId: string) => void
  /** Deletes one history entry. Called after the row has already left the screen. */
  onDeleteSession: (sessionId: string) => void
  /** Current Scene's token usage (doc §4: stats card is current-Scene scoped). */
  tokenUsage: StudioTokenUsage | null
  /** Saved user messages of the current Scene (failed local submits are not counted). */
  sentRounds: number
  /** Label of the current Scene, e.g. "Scene 2". */
  sceneLabel: string
  /** Which studio this shell drives: the manim studio says "Scene", the Plot Studio says "图片". */
  studioKind: StudioKind
  /** Leaves the studio and returns to the home screen. */
  onExit: () => void
}

export function SessionSidebar({
  open,
  onToggle,
  currentSessionId,
  currentTitle,
  historyIds,
  feedbackKey,
  onCreate,
  onRetry,
  onSelectSession,
  onDeleteSession,
  tokenUsage,
  sentRounds,
  sceneLabel,
  studioKind,
  onExit,
}: SessionSidebarProps) {
  const { t } = useI18n()
  // The scrim fades out while the drawer snaps back; the drawer itself is the rail once it closes.
  const scrimPresence = usePresence(open, 200)

  // The list is a feed read downwards, so a new Session is appended and the list follows it to the
  // bottom. It scrolls there instead of jumping, and opening the list lands where the user already is.
  const rowRefs = useRef(new Map<string, HTMLLIElement | null>())
  useEffect(() => {
    if (!open) {
      return
    }
    scrollIntoViewSoftly(currentSessionId ? rowRefs.current.get(currentSessionId) : null)
  }, [currentSessionId, open])

  // Deleting is asked about first. The dialog keeps its target while it fades out, so the sentence does
  // not blink away with it, and the row that is going keeps its own id until it has finished leaving.
  const [deleteRequest, setDeleteRequest] = useState<{ sessionId: string; label: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const deletePresence = usePresence(deleteOpen, DELETE_DIALOG_EXIT_MS)
  const removeTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (removeTimerRef.current !== null) {
        window.clearTimeout(removeTimerRef.current)
      }
    },
    [],
  )
  useEffect(() => {
    if (!deleteOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setDeleteOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [deleteOpen])

  // The row leaves the screen before the list is told it is gone: it fades and collapses its own height,
  // so the rows below close the gap with the same motion instead of jumping into it. The delete itself is
  // asked for immediately — waiting out the exit would only add the two delays together — and the list
  // stays untouched until it answers, so a refused delete simply brings the row back.
  const confirmDelete = () => {
    const request = deleteRequest
    setDeleteOpen(false)
    if (request === null) {
      return
    }
    setRemovingId(request.sessionId)
    void onDeleteSession(request.sessionId)
    removeTimerRef.current = window.setTimeout(() => {
      removeTimerRef.current = null
      setRemovingId(null)
    }, ROW_REMOVE_MS)
  }

  // One element, two widths: collapsing is a width transition with the content cross-fading inside a
  // clipped track, so the rail never swaps the root node in and out (which cannot be animated).
  return (
    <>
      {/* Narrow screens only: tapping outside closes the overlay, so the composer stays reachable. */}
      {scrimPresence.mounted ? (
        <button
          type="button"
          className={`absolute inset-0 z-20 bg-black/30 lg:hidden ${
            open ? 'studio-fade-in' : 'studio-fade-out'
          }`}
          aria-label={open ? t('studio.cinema.sidebarBackdrop') : undefined}
          aria-hidden={open ? undefined : true}
          inert={open ? undefined : true}
          tabIndex={open ? undefined : -1}
          onClick={onToggle}
        />
      ) : null}
      <aside
        data-assemble="sidebar"
        aria-label={open ? t('studio.cinema.sidebarLabel') : undefined}
        className={`flex shrink-0 flex-col overflow-hidden border-r border-black/5 transition-[width] duration-300 ease-move dark:border-white/10 ${
          open
            ? 'studio-drawer-in absolute inset-y-0 left-0 z-30 w-60 bg-bg-primary shadow-xl lg:static lg:z-auto lg:bg-transparent lg:shadow-none'
            : 'w-14'
        }`}
      >
        {open ? (
          <div className="studio-fade-in flex h-full w-60 shrink-0 flex-col gap-3 px-3 py-3">
            <div className="flex items-center gap-2">
              <LogoUsagePopover studioKind={studioKind} usage={tokenUsage} sentRounds={sentRounds} sceneLabel={sceneLabel} />
              <p className="min-w-0 flex-1 truncate text-base font-medium text-text-primary/85" title={currentTitle}>
                {currentTitle}
              </p>
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary/70 transition-all hover:bg-bg-secondary/50 hover:text-text-secondary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                aria-expanded
                aria-label={t('studio.cinema.sidebarCollapse')}
                title={t('studio.cinema.sidebarCollapse')}
                onClick={onToggle}
              >
                <ChevronLeftIcon />
              </button>
            </div>

            <button
              type="button"
              className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-base text-text-primary/85 transition-colors hover:bg-bg-tertiary/50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              onClick={onCreate}
            >
              <PlusIcon />
              <span>{t('studio.cinema.newSession')}</span>
            </button>

            {feedbackKey ? (
              <div className="studio-rise-in rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                <p className="text-sm text-amber-700 dark:text-amber-300">{t(feedbackKey)}</p>
                <button
                  type="button"
                  className="mt-1 inline-flex min-h-[44px] items-center text-sm underline decoration-dotted"
                  onClick={onRetry}
                >
                  {t('studio.cinema.sessionRetry')}
                </button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="mb-1 text-sm uppercase tracking-[0.18em] text-text-secondary/45">
                {t('studio.cinema.recentSessions')}
              </p>
              {historyIds.length === 0 ? (
                <p className="text-sm text-text-secondary/55">{t('studio.cinema.recentSessionsEmpty')}</p>
              ) : null}
              <ul className="space-y-1" aria-label={t('studio.cinema.recentSessions')}>
                {historyIds.map((sessionId, index) => {
                  const isCurrent = sessionId === currentSessionId
                  const label = t('studio.cinema.sessionEntry', { index: index + 1 })
                  const isRemoving = removingId === sessionId
                  return (
                    <li
                      key={sessionId}
                      data-session-id={sessionId}
                      ref={(node) => {
                        if (node) {
                          rowRefs.current.set(sessionId, node)
                        } else {
                          rowRefs.current.delete(sessionId)
                        }
                      }}
                      /* `grid-rows-[1fr] -> [0fr]` collapses the row without measuring it: the row is
                         the grid's only track, so the height it gives back is its own. */
                      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-[220ms] ease-exit ${
                        isRemoving ? 'studio-row-removing grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
                      }`}
                    >
                      <div className="group relative min-h-0">
                        <button
                          type="button"
                          className={`flex min-h-[44px] w-full items-center truncate rounded-xl py-1.5 pl-3 pr-11 text-left text-sm transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                            isCurrent ? 'bg-bg-tertiary/60 text-text-primary' : 'text-text-secondary/70'
                          }`}
                          aria-current={isCurrent ? 'true' : undefined}
                          title={label}
                          onClick={() => onSelectSession(sessionId)}
                        >
                          {label}
                        </button>
                        {/* The row's own action: it appears where the pointer already is. Always reachable
                            by keyboard (focus), and visible without hover on touch widths. */}
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-text-secondary/60 transition-opacity hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                          aria-label={`${t('studio.cinema.sessionDelete')}：${label}`}
                          title={t('studio.cinema.sessionDelete')}
                          onClick={() => {
                            setDeleteRequest({ sessionId, label })
                            setDeleteOpen(true)
                          }}
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Back to the home screen: bottom-left corner, arrow + 退出 label. */}
            <button
              type="button"
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-text-secondary/70 transition-all hover:bg-bg-secondary/50 hover:text-text-secondary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              aria-label={t('studio.cinema.exit')}
              title={t('studio.cinema.exit')}
              onClick={onExit}
            >
              <ArrowLeftIcon />
              <span className="text-sm">{t('studio.cinema.exitShort')}</span>
            </button>
          </div>
        ) : (
          /* Collapsed: the rail. The logo stays the way back in, the exit stays reachable. */
          <div className="flex h-full w-14 shrink-0 flex-col items-center gap-3 py-3">
            <ManimCatLogo className="h-9 w-9 rounded-full" />
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary/70 transition-all hover:bg-bg-secondary/50 hover:text-text-secondary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              aria-expanded={false}
              aria-label={t('studio.cinema.sidebarExpand')}
              title={t('studio.cinema.sidebarExpand')}
              onClick={onToggle}
            >
              <ChevronRightIcon />
            </button>
            {/* Back to the home screen, bottom-left, mirroring the expanded column. */}
            <button
              type="button"
              className="mt-auto flex h-10 w-10 items-center justify-center rounded-full text-text-secondary/70 transition-all hover:bg-bg-secondary/50 hover:text-text-secondary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              aria-label={t('studio.cinema.exit')}
              title={t('studio.cinema.exit')}
              onClick={onExit}
            >
              <ArrowLeftIcon />
            </button>
          </div>
        )}
      </aside>

      {/* Confirming a delete. Same shape as every other overlay here: a backdrop, a dialog role, Escape
          closes, and the fade-out is not part of the dialog any more (role and pointer target are gone). */}
      {deletePresence.mounted && deleteRequest ? (
        <div
          className={`${deleteOpen ? 'studio-fade-in' : 'studio-fade-out'} fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4`}
          role={deleteOpen ? 'dialog' : undefined}
          aria-modal={deleteOpen ? 'true' : undefined}
          aria-label={deleteOpen ? t('studio.cinema.sessionDeleteTitle') : undefined}
          aria-hidden={deleteOpen ? undefined : true}
          inert={deleteOpen ? undefined : true}
          onClick={() => setDeleteOpen(false)}
        >
          <div
            data-testid="session-delete-dialog"
            className={`${deleteOpen ? 'studio-sheet-in' : 'studio-sheet-out'} w-full max-w-sm rounded-2xl border border-black/10 bg-bg-primary p-5 shadow-2xl dark:border-white/15`}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-medium text-text-primary/85">
              {t('studio.cinema.sessionDeleteTitle')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {t('studio.cinema.sessionDeleteBody', { label: deleteRequest.label })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center rounded-xl border border-black/10 px-4 text-sm transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 dark:border-white/15"
                onClick={() => setDeleteOpen(false)}
              >
                {t('studio.cinema.sessionDeleteCancel')}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center rounded-xl bg-red-600/90 px-4 text-sm text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                onClick={confirmDelete}
              >
                {t('studio.cinema.sessionDeleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}