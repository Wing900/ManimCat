import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import ManimCatLogo from '../../../components/ManimCatLogo'
import type { StudioTokenUsage } from '../../protocol/studio-agent-types'
import { LogoUsagePopover } from './LogoUsagePopover'

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
  status: 'loading' | 'ready' | 'unavailable'
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
}

export function SessionSidebar({
  open,
  onToggle,
  currentSessionId,
  currentTitle,
  historyIds,
  status,
  feedbackKey,
  onCreate,
  onRetry,
  onSelectSession,
  tokenUsage,
  sentRounds,
  sceneLabel,
}: SessionSidebarProps) {
  const { t } = useI18n()

  if (!open) {
    return (
      <div className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-black/5 py-3 dark:border-white/10">
        <ManimCatLogo className="h-9 w-9 rounded-full" />
        <button
          type="button"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-black/10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
          aria-expanded={false}
          aria-label={t('studio.cinema.sidebarExpand')}
          onClick={onToggle}
        >
          {t('studio.cinema.sidebarExpandShort')}
        </button>
      </div>
    )
  }

  return (
    <>
      {/* Narrow screens only: tapping outside closes the overlay, so the composer stays reachable. */}
      <button
        type="button"
        className="absolute inset-0 z-20 bg-black/30 lg:hidden"
        aria-label={t('studio.cinema.sidebarBackdrop')}
        onClick={onToggle}
      />
      <aside
        className="absolute inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col gap-3 border-r border-black/5 bg-bg-primary px-3 py-3 shadow-xl lg:static lg:z-auto lg:bg-transparent lg:shadow-none dark:border-white/10"
        aria-label={t('studio.cinema.sidebarLabel')}
      >
      <div className="flex items-center gap-2">
        <LogoUsagePopover usage={tokenUsage} sentRounds={sentRounds} sceneLabel={sceneLabel} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-text-primary/85" title={t('studio.cinema.sessionTitle')}>
            {t('studio.cinema.sessionTitle')}
          </p>
          <p className="truncate text-sm text-text-secondary/60" title={currentTitle}>
            {currentTitle}
          </p>
        </div>
        <button
          type="button"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-black/10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
          aria-expanded
          aria-label={t('studio.cinema.sidebarCollapse')}
          onClick={onToggle}
        >
          {t('studio.cinema.sidebarCollapseShort')}
        </button>
      </div>

      <button
        type="button"
        className="flex min-h-[44px] items-center justify-center rounded-lg border border-black/10 px-3 text-base text-text-primary/85 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
        onClick={onCreate}
      >
        {t('studio.cinema.newSession')}
      </button>

      {feedbackKey ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
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
                  className={`flex min-h-[44px] w-full items-center truncate rounded-md px-2 py-1.5 text-left text-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 ${
                    isCurrent ? 'bg-accent-rgb/10 text-text-primary/90' : 'text-text-secondary/70'
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

      {status === 'loading' ? (
        <p className="text-sm text-text-secondary/55">{t('studio.cinema.sessionLoading')}</p>
      ) : null}
      </aside>
    </>
  )
}