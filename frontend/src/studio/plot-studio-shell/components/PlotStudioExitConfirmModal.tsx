import { useModalTransition } from '../../../hooks/useModalTransition'
import { useI18n } from '../../../i18n'

interface PlotStudioExitConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

export function PlotStudioExitConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: PlotStudioExitConfirmModalProps) {
  const { t } = useI18n()
  const { shouldRender, isExiting } = useModalTransition(isOpen)

  if (!shouldRender) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md ${
          isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'
        }`}
        onClick={onClose}
      />

      <div
        className={`relative w-full max-w-sm rounded-[2.2rem] border border-border/5 bg-bg-secondary p-8 shadow-2xl ${
          isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium tracking-tight text-text-primary">
              {t('studio.exitConfirmTitle')}
            </h2>
            <p className="mt-3 text-sm leading-7 text-text-secondary/72">
              {t('studio.exitConfirmDescription')}
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
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-bg-primary/50 px-5 py-3.5 text-sm font-medium text-text-secondary transition-all hover:bg-bg-tertiary hover:text-text-primary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-2xl bg-accent px-5 py-3.5 text-sm font-medium text-bg-primary shadow-md shadow-accent/10 transition-all hover:bg-accent/90"
          >
            {t('studio.exitConfirmAction')}
          </button>
        </div>
      </div>
    </div>
  )
}
