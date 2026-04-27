import { useI18n } from '../../../i18n'

interface LightboxToolbarProps {
  activeIndex: number
  total: number
  editableFilename?: string
  zoom: number
  zoomDisplayScale?: number
  isStudioAppearance: boolean
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  onStepZoom: (delta: number) => void
}

export function LightboxToolbar({
  activeIndex,
  total,
  editableFilename,
  zoom,
  zoomDisplayScale = 1,
  isStudioAppearance,
  onPrev,
  onNext,
  onClose,
  onStepZoom,
}: LightboxToolbarProps) {
  const { t } = useI18n()

  return (
    <div className={`relative z-10 flex items-center justify-between ${
      isStudioAppearance ? 'px-6 py-5' : 'px-5 py-3'
    }`}>
      <div className={`text-xs ${isStudioAppearance ? 'text-text-secondary/60 dark:text-text-secondary/72' : ''}`}>
        {isStudioAppearance ? editableFilename ?? t('image.lightboxTitle', { current: activeIndex + 1, total }) : t('image.lightboxTitle', { current: activeIndex + 1, total })}
      </div>
      <div className="flex items-center gap-3">
        {onPrev ? (
          <button type="button" onClick={onPrev} className="rounded border border-black/10 bg-white/70 px-2 py-1 text-xs hover:bg-white/90 dark:border-white/10 dark:bg-bg-secondary/78 dark:hover:bg-bg-secondary">
            ←
          </button>
        ) : null}
        {onNext ? (
          <button type="button" onClick={onNext} className="rounded border border-black/10 bg-white/70 px-2 py-1 text-xs hover:bg-white/90 dark:border-white/10 dark:bg-bg-secondary/78 dark:hover:bg-bg-secondary">
            →
          </button>
        ) : null}
        <button type="button" onClick={() => onStepZoom(-0.05)} className="rounded border border-black/10 bg-white/70 px-2 py-1 text-xs hover:bg-white/90 dark:border-white/10 dark:bg-bg-secondary/78 dark:hover:bg-bg-secondary">
          -
        </button>
        <span className="text-xs tabular-nums text-text-secondary dark:text-text-secondary">{Math.round(zoom * zoomDisplayScale * 100)}%</span>
        <button type="button" onClick={() => onStepZoom(0.05)} className="rounded border border-black/10 bg-white/70 px-2 py-1 text-xs hover:bg-white/90 dark:border-white/10 dark:bg-bg-secondary/78 dark:hover:bg-bg-secondary">
          +
        </button>
        <button type="button" onClick={onClose} className={`rounded px-2 py-1 text-xs ${
          isStudioAppearance
            ? 'text-text-secondary/60 hover:text-text-primary dark:text-text-secondary/72 dark:hover:text-text-primary'
            : 'border border-black/10 bg-white/70 hover:bg-white/90 dark:border-white/10 dark:bg-bg-secondary/78 dark:hover:bg-bg-secondary'
        }`}>
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
