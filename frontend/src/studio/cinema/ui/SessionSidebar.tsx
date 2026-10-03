import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import ManimCatLogo from '../../../components/ManimCatLogo'

/**
 * Session sidebar (task 11C2).
 *
 * The list is exactly the local recent Session ids: there is no cloud-wide history endpoint, and the
 * sidebar never claims one. A Session whose restore failed stays listed (a temporary outage is not a
 * deleted Session); only a definite 404 answer removes an entry.
 *
 * Layout (correction R4): below `lg` the expanded sidebar floats over the screen with a backdrop
 * instead of taking width away from the video and the composer; from `lg` up it is an in-flow column
 * again. Pure CSS breakpoints — no window listener, no resize polling.
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
}: SessionSidebarProps) {
  const { t } = useI18n()

  if (!open) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center gap-3 border-r border-black/5 py-3 dark:border-white/10">
        <ManimCatLogo className="h-7 w-7 rounded-full" />
        <button
          type="button"
          className="rounded-md border border-black/10 px-1.5 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
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
        className="absolute inset-y-0 left-0 z-30 flex w-56 shrink-0 flex-col gap-3 border-r border-black/5 bg-bg-primary px-3 py-3 shadow-xl lg:static lg:z-auto lg:bg-transparent lg:shadow-none dark:border-white/10"
        aria-label={t('studio.cinema.sidebarLabel')}
      >
      <div className="flex items-center gap-2">
        <ManimCatLogo className="h-7 w-7 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-text-primary/85">{t('studio.cinema.sessionTitle')}</p>
          <p className="truncate text-[11px] text-text-secondary/60">{currentTitle}</p>
        </div>
        <button
          type="button"
          className="rounded-md border border-black/10 px-1.5 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
          aria-expanded
          aria-label={t('studio.cinema.sidebarCollapse')}
          onClick={onToggle}
        >
          {t('studio.cinema.sidebarCollapseShort')}
        </button>
      </div>

      <button
        type="button"
        className="rounded-lg border border-black/10 px-2 py-1.5 text-xs text-text-primary/85 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
        onClick={onCreate}
      >
        {t('studio.cinema.newSession')}
      </button>

      {feedbackKey ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
          <p className="text-[11px] text-amber-700 dark:text-amber-300">{t(feedbackKey)}</p>
          <button
            type="button"
            className="mt-1 text-[11px] underline decoration-dotted"
            onClick={onRetry}
          >
            {t('studio.cinema.sessionRetry')}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-text-secondary/45">
          {t('studio.cinema.recentSessions')}
        </p>
        {historyIds.length === 0 ? (
          <p className="text-[11px] text-text-secondary/55">{t('studio.cinema.recentSessionsEmpty')}</p>
        ) : null}
        <ul className="space-y-1" aria-label={t('studio.cinema.recentSessions')}>
          {historyIds.map((sessionId, index) => {
            const isCurrent = sessionId === currentSessionId
            return (
              <li key={sessionId}>
                <button
                  type="button"
                  className={`w-full truncate rounded-md px-2 py-1 text-left text-[11px] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 ${
                    isCurrent ? 'bg-accent-rgb/10 text-text-primary/90' : 'text-text-secondary/70'
                  }`}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => onSelectSession(sessionId)}
                >
                  {t('studio.cinema.sessionEntry', { index: index + 1 })}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {status === 'loading' ? (
        <p className="text-[11px] text-text-secondary/55">{t('studio.cinema.sessionLoading')}</p>
      ) : null}
      </aside>
    </>
  )
}
