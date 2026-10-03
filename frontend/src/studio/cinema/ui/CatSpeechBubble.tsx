import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import type { CatFeedbackKind } from './cat-feedback'

/**
 * CatSpeechBubble (doc §7.2): the one short thing the cat says.
 *
 * Its content is either the verbatim opening of the cat's own reply (`text`), a state report resolved
 * through i18n (`bubbleKey`), or the typing dots (`typing`) while that reply is still being produced —
 * never a full model reply, a tool parameter, an internal path or a stack. It fades in/out (120–180ms) and hides when not visible. Hover or focus pauses the fade
 * (delegated to the hook); a state with a recover entry exposes a button the caller wires to the
 * existing retry/reconcile actions.
 */

export interface CatSpeechBubbleProps {
  /** Verbatim reply opening; wins over `bubbleKey` when both are set. */
  text?: string
  /** True while the run is still producing the reply: the bubble shows three typing dots instead. */
  typing?: boolean
  bubbleKey?: TranslationKey
  params?: Record<string, number | string>
  visible: boolean
  kind: CatFeedbackKind
  hasRecoverEntry: boolean
  onHoverStart: () => void
  onHoverEnd: () => void
  /** Wired by the caller to the existing retry/reconcile/reconnect action for the current state. */
  onRecover?: () => void
  recoverLabelKey?: TranslationKey
}

export function CatSpeechBubble({
  text,
  typing,
  bubbleKey,
  params,
  visible,
  kind,
  hasRecoverEntry,
  onHoverStart,
  onHoverEnd,
  onRecover,
  recoverLabelKey,
}: CatSpeechBubbleProps) {
  const { t } = useI18n()

  return (
    <div
      className={`pointer-events-auto max-w-[12rem] rounded-2xl border border-black/10 bg-bg-primary/95 px-3 py-2 text-sm text-text-primary/90 shadow-lg transition-opacity duration-150 dark:border-white/15 ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      role="status"
      aria-live="polite"
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
      data-testid="cinema-cat-bubble"
    >
      {typing ? (
        /* The same three pulsing dots the conversation uses, so "composing" looks the same everywhere. */
        <p
          aria-hidden="true"
          data-testid="cinema-cat-typing"
          className="flex items-center gap-1 px-0.5 py-1"
        >
          <span className="cinema-thinking-dot h-1.5 w-1.5 rounded-full bg-text-primary/60" />
          <span className="cinema-thinking-dot h-1.5 w-1.5 rounded-full bg-text-primary/60" />
          <span className="cinema-thinking-dot h-1.5 w-1.5 rounded-full bg-text-primary/60" />
        </p>
      ) : (
        <p className="whitespace-pre-wrap break-words leading-snug">
          {text ?? (bubbleKey ? t(bubbleKey, params) : '')}
        </p>
      )}
      {typing ? <span className="sr-only">{t('studio.cinema.catTyping')}</span> : null}
      {hasRecoverEntry && onRecover && recoverLabelKey ? (
        <button
          type="button"
          className="mt-1.5 inline-flex min-h-[36px] items-center rounded-md border border-black/10 px-2.5 text-sm text-text-secondary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 dark:border-white/15"
          onClick={onRecover}
        >
          {t(recoverLabelKey)}
        </button>
      ) : null}
      {kind === 'persistent' ? <span className="sr-only">{t('studio.cinema.catBubblePersistentHint')}</span> : null}
    </div>
  )
}