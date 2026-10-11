import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../shared/i18n/index'
import { useModalTransition } from '../../shared/hooks/useModalTransition'
import { TrashMark } from './settings-icons'

interface ClearAiSettingsDialogProps {
  isOpen: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 「确定真的清除吗？」
 *
 * This is the only irreversible act in Settings, so it gets its own door to walk through rather than
 * a two-step button: the key, the address and the model all go, and nothing brings them back.
 *
 * It is portalled to `<body>` because of how it is reached. The settings pane it opens from carries
 * `panel-in`, an animation with `fill-mode: both` — which leaves a real `transform` on that pane, and
 * any element with a transform becomes the containing block for its `fixed` descendants. Left in
 * place, `fixed inset-0` centred the dialog inside the pane instead of the window. Portalling is what
 * `ImageLightbox` does for the same reason.
 */
export function ClearAiSettingsDialog({ isOpen, onCancel, onConfirm }: ClearAiSettingsDialogProps) {
  const { t } = useI18n()
  const { shouldRender, isExiting } = useModalTransition(isOpen)

  useEffect(() => {
    if (!isOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onCancel])

  if (!shouldRender) return null

  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-bg-primary/40 backdrop-blur-sm ${
          isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'
        }`}
        onClick={onCancel}
      />

      <div
        className={`relative w-full max-w-md rounded-[2rem] border border-border/5 bg-bg-secondary p-8 shadow-2xl ${
          isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
        }`}
      >
        <div className="mb-3 flex items-center gap-3 text-text-primary">
          <TrashMark className="h-5 w-5 opacity-70" />
          <h2 className="text-lg font-medium tracking-tight">{t('settings.ai.clearConfirmTitle')}</h2>
        </div>

        <p className="mb-8 text-sm leading-relaxed text-text-secondary/70">
          {t('settings.ai.clearConfirmBody')}
        </p>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl px-5 py-2.5 text-sm text-text-secondary transition-colors duration-200 ease-ui hover:bg-bg-primary/60 hover:text-text-primary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 ease-ui hover:bg-red-700"
          >
            {t('settings.ai.clearConfirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
