import { useI18n } from '../../i18n'
import { useModalTransition } from '../../hooks/useModalTransition'
import type { StudioPermissionMode } from '../protocol/studio-agent-types'

interface StudioPermissionModeModalProps {
  isOpen: boolean
  mode: StudioPermissionMode | null
  isSubmitting: boolean
  onClose: () => void
  onConfirm: () => void
}

export function StudioPermissionModeModal({
  isOpen,
  mode,
  isSubmitting,
  onClose,
  onConfirm,
}: StudioPermissionModeModalProps) {
  const { t } = useI18n()
  const { shouldRender, isExiting } = useModalTransition(isOpen)

  if (!shouldRender || !mode) {
    return null
  }

  const titleKey = mode === 'safe'
    ? 'studio.control.mode.safe'
    : mode === 'full'
      ? 'studio.control.mode.full'
      : 'studio.control.mode.auto'
  const descriptionKey = mode === 'safe'
    ? 'studio.control.mode.safeDescription'
    : mode === 'full'
      ? 'studio.control.mode.fullDescription'
      : 'studio.control.mode.autoDescription'

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md transition-opacity duration-300 ${
          isExiting ? 'opacity-0' : 'animate-overlay-wash-in'
        }`}
        onClick={isSubmitting ? undefined : onClose}
      />

      <div className={`relative w-full max-w-md rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl ${
        isExiting ? 'animate-fade-out-soft' : 'animate-fade-in-soft'
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-accent-rgb/40 animate-pulse" />
            <h2 className="text-xl font-medium tracking-tight text-text-primary">{t('studio.control.confirmTitle')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl p-2.5 text-text-secondary/50 transition-all hover:bg-bg-primary/50 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-8 rounded-[2rem] border border-border/6 bg-bg-primary/35 px-6 py-5">
          <div className="text-[11px] uppercase tracking-[0.28em] text-text-secondary/45">{t('studio.control.targetLabel')}</div>
          <div className="mt-3 text-lg font-medium text-text-primary">{t(titleKey)}</div>
          <div className="mt-2 text-sm leading-7 text-text-secondary/72">{t(descriptionKey)}</div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl bg-bg-primary/50 px-6 py-4 text-sm font-medium text-text-secondary transition-all hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('studio.control.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded-2xl bg-accent px-6 py-4 text-sm font-medium text-bg-primary shadow-md shadow-accent/10 transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? t('studio.control.applying') : t('studio.control.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
