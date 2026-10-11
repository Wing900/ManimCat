import { useI18n } from '../../../../shared/i18n/index'
import type { TranslationKey } from '../../../../shared/i18n/messages'

/** Real readiness feedback, independent of rendering progress and video playback. */
export function CinemaLoadingStatus({ labelKey, compact = false }: {
  labelKey: TranslationKey
  compact?: boolean
}) {
  const { t } = useI18n()
  return (
    <div role="status" aria-live="polite" aria-atomic="true"
      className={`pointer-events-none flex items-center text-text-secondary ${compact ? 'gap-2 text-xs' : 'flex-col gap-4 text-sm'}`}>
      <span aria-hidden="true"
        className={`rounded-full border-2 border-text-secondary/20 border-t-text-secondary motion-safe:animate-spin ${compact ? 'h-4 w-4' : 'h-9 w-9'}`} />
      <span>{t(labelKey)}</span>
    </div>
  )
}
