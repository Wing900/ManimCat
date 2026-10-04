import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import ManimCatLogo from '../../../components/ManimCatLogo'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from './CinemaIcons'
import type { StudioKind, StudioTokenUsage } from '../../protocol/studio-agent-types'
import { LogoUsagePopover } from './LogoUsagePopover'
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
  tokenUsage,
  sentRounds,
  sceneLabel,
  studioKind,
  onExit,
}: SessionSidebarProps) {
  const { t } = useI18n()
  // The scrim fades out while the drawer snaps back; the drawer itself is the rail once it closes.
  const scrimPresence = usePresence(open, 200)

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
                  return (
                    <li key={sessionId}>
                      <button
                        type="button"
                        className={`flex min-h-[44px] w-full items-center truncate rounded-xl px-3 py-1.5 text-left text-sm transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                          isCurrent ? 'bg-bg-tertiary/60 text-text-primary' : 'text-text-secondary/70'
                        }`}
                        aria-current={isCurrent ? 'true' : undefined}
                        title={label}
                        onClick={() => onSelectSession(sessionId)}
                      >
                        {label}
                      </button>
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
    </>
  )
}