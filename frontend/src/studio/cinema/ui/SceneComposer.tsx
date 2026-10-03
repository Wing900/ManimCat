import { useRef, type KeyboardEvent } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import { useI18n } from '../../../i18n'

/**
 * The always-visible composer (task 11C2).
 *
 * Closing the history panel never closes, clears or disables this; it keeps its own draft, which lives
 * in the Scene record, so switching Scene changes the text but never mixes two drafts.
 *
 * Layout (correction R4): the disable reason sits on its own full-width line above the input row, so a
 * narrow screen never spends the input's width on it; the input itself is `min-w-0 flex-1` and the two
 * buttons stay shrink-proof.
 */

export interface SceneComposerProps {
  draft: string
  submitting: boolean
  canSubmit: boolean
  canCancel: boolean
  /** Why the send button is disabled, already narrowed to a stable local sentence. */
  blockedReasonKey: TranslationKey | null
  onDraftChange: (text: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export function SceneComposer({
  draft,
  submitting,
  canSubmit,
  canCancel,
  blockedReasonKey,
  onDraftChange,
  onSubmit,
  onCancel,
}: SceneComposerProps) {
  const { t } = useI18n()
  const composingRef = useRef(false)

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }
    // A Chinese IME confirms candidates with Enter: that keypress belongs to the IME, not to us.
    if (composingRef.current || event.nativeEvent.isComposing) {
      return
    }
    event.preventDefault()
    if (canSubmit) {
      onSubmit()
    }
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-1 border-t border-black/5 bg-bg-primary/70 px-3 pb-3 pt-2 dark:border-white/10"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) {
          onSubmit()
        }
      }}
    >
      {blockedReasonKey ? (
        <p id="cinema-composer-blocked" className="text-[11px] text-text-secondary/70">
          {t(blockedReasonKey)}
        </p>
      ) : null}

      <div className="flex min-w-0 items-end gap-2">
        <textarea
          className="min-h-[44px] min-w-0 flex-1 resize-none rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-rgb/60 focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15 dark:bg-white/5"
          value={draft}
          rows={1}
          placeholder={t('studio.cinema.composerPlaceholder')}
          aria-label={t('studio.cinema.composerPlaceholder')}
          aria-describedby={blockedReasonKey ? 'cinema-composer-blocked' : undefined}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
        />

        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-text-secondary transition-opacity hover:opacity-80 disabled:opacity-40 dark:border-white/15"
            onClick={onCancel}
            disabled={!canCancel}
            aria-label={t('studio.cinema.stop')}
          >
            {t('studio.cinema.stop')}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-accent-rgb/90 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={!canSubmit}
            aria-label={t('studio.cinema.send')}
          >
            {submitting ? t('studio.cinema.sending') : t('studio.cinema.send')}
          </button>
        </div>
      </div>
    </form>
  )
}
