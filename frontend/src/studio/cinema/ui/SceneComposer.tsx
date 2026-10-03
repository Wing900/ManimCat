import { useRef, type KeyboardEvent } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import { useI18n } from '../../../i18n'
import { SendIcon, StopIcon } from './CinemaIcons'

/**
 * The always-visible composer (task 11C2).
 *
 * Closing the history panel never closes, clears or disables this; it keeps its own draft, which lives
 * in the Scene record, so switching Scene changes the text but never mixes two drafts.
 *
 * Layout: one soft surface (no border, doc: 去框化) holds the textarea and the two icon actions, so the
 * composer reads as a single input centred under the stage. Stop and Send are icons, not text; Stop
 * stays mounted while disabled so the control is always addressable. A hint line spells out the
 * keyboard contract (Enter sends, Shift+Enter breaks the line).
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
      className="flex min-w-0 flex-col border-t border-black/5 bg-bg-primary/70 px-3 pb-8 pt-6 dark:border-white/10"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) {
          onSubmit()
        }
      }}
    >
      <div className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-3">
        {blockedReasonKey ? (
          <p id="cinema-composer-blocked" className="px-2 text-sm text-text-secondary/70">
            {t(blockedReasonKey)}
          </p>
        ) : null}

        <div className="flex min-w-0 items-end rounded-2xl bg-white/70 px-1.5 py-1.5 dark:bg-white/5">
          <textarea
            className="min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[17px] leading-relaxed text-text-primary outline-none"
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

          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary/60 transition-all hover:bg-bg-tertiary/60 hover:text-text-secondary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 disabled:opacity-30"
            onClick={onCancel}
            disabled={!canCancel}
            aria-label={t('studio.cinema.stop')}
            title={t('studio.cinema.stop')}
          >
            <StopIcon />
          </button>
          <button
            type="submit"
            className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-rgb/90 text-white transition-all hover:opacity-90 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/40 disabled:opacity-30"
            disabled={!canSubmit}
            aria-label={t('studio.cinema.send')}
            title={submitting ? t('studio.cinema.sending') : t('studio.cinema.send')}
          >
            <SendIcon />
          </button>
        </div>

        <p className="text-center text-xs text-text-secondary/50">{t('studio.cinema.composerHint')}</p>
      </div>
    </form>
  )
}
