import type { Ref } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import { useI18n } from '../../../i18n'
import ManimCatLogo from '../../../components/ManimCatLogo'

/**
 * The cat is the one entry to the conversation history (task 11C2).
 *
 * It shows exactly one safe sentence about the Scene it stands next to and never accumulates a second
 * chat list. Opening and closing is a user action only: sending, completing or failing never expands
 * the panel.
 */

export interface CatAssistantProps {
  statusKey: TranslationKey
  statusParams?: Record<string, number | string>
  tone: 'idle' | 'busy' | 'warning' | 'error'
  historyOpen: boolean
  historyPanelId: string
  buttonRef?: Ref<HTMLButtonElement>
  onToggleHistory: () => void
}

const TONE_CLASSES: Record<CatAssistantProps['tone'], string> = {
  idle: 'text-text-secondary/75',
  busy: 'text-accent-rgb',
  warning: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
}

export function CatAssistant({
  statusKey,
  statusParams,
  tone,
  historyOpen,
  historyPanelId,
  buttonRef,
  onToggleHistory,
}: CatAssistantProps) {
  const { t } = useI18n()

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <button
        ref={buttonRef}
        type="button"
        className="flex items-center gap-2 rounded-full border border-black/10 bg-white/60 px-2 py-1 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/40 dark:border-white/15 dark:bg-white/5"
        aria-label={t('studio.cinema.catEntryLabel')}
        aria-expanded={historyOpen}
        aria-controls={historyPanelId}
        onClick={onToggleHistory}
      >
        <ManimCatLogo className="h-7 w-7 rounded-full" />
        <span className="text-[11px] text-text-secondary/60">
          {historyOpen ? t('studio.cinema.catHistoryHide') : t('studio.cinema.catHistoryShow')}
        </span>
      </button>

      <p
        className={`min-w-0 flex-1 truncate text-xs ${TONE_CLASSES[tone]}`}
        data-testid="cinema-cat-status"
        role="status"
        aria-live="polite"
      >
        {t(statusKey, statusParams)}
      </p>
    </div>
  )
}
