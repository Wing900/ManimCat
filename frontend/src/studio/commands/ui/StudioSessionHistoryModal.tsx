import { useModalTransition } from '../../../hooks/useModalTransition'
import { useI18n } from '../../../i18n'
import { formatStudioTime, truncateStudioText } from '../../theme'
import type { StudioSessionHistoryEntry } from '../../hooks/use-studio-session'

interface StudioSessionHistoryModalProps {
  isOpen: boolean
  isLoading: boolean
  entries: StudioSessionHistoryEntry[]
  currentSessionId: string | null
  onClose: () => void
  onSelectSession: (sessionId: string) => Promise<void> | void
}

export function StudioSessionHistoryModal({
  isOpen,
  isLoading,
  entries,
  currentSessionId,
  onClose,
  onSelectSession,
}: StudioSessionHistoryModalProps) {
  const { t } = useI18n()
  const { shouldRender, isExiting } = useModalTransition(isOpen)

  if (!shouldRender) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md ${
          isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'
        }`}
        onClick={onClose}
      />

      <section
        className={`relative flex max-h-[min(80vh,52rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[2.2rem] border border-border/10 bg-bg-secondary shadow-2xl ${
          isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/8 px-8 py-7">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.38em] text-text-secondary/45">History</div>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-text-primary">
              {t('studio.sessionLabel')}
            </h2>
            <p className="mt-2 text-sm leading-7 text-text-secondary/68">
              Recent studio sessions saved on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl p-2.5 text-text-secondary/50 transition-all hover:bg-bg-primary/50 hover:text-text-primary"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {isLoading && (
            <div className="flex h-40 items-center justify-center text-sm text-text-secondary/65">
              Loading sessions...
            </div>
          )}

          {!isLoading && entries.length === 0 && (
            <div className="flex h-40 items-center justify-center text-center text-sm text-text-secondary/65">
              No recent sessions on this device yet.
            </div>
          )}

          {!isLoading && entries.length > 0 && (
            <div className="space-y-3">
              {entries.map((entry) => {
                const isCurrent = entry.id === currentSessionId
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => void onSelectSession(entry.id)}
                    className={`w-full rounded-[1.6rem] border px-5 py-4 text-left transition-all ${
                      isCurrent
                        ? 'border-black/10 bg-bg-primary/72 dark:border-white/10 dark:bg-bg-primary/45'
                        : 'border-transparent bg-bg-primary/35 hover:border-border/10 hover:bg-bg-primary/58'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-primary">{entry.title}</div>
                        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.26em] text-text-secondary/42">
                          {entry.studioKind} · {formatStudioTime(entry.updatedAt)}
                        </div>
                      </div>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-accent">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-text-secondary/72">
                      {truncateStudioText(entry.previewText, 140)}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
