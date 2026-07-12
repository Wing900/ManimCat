import { useI18n } from '../i18n';
import { useModalTransition } from '../hooks/useModalTransition';

interface ImageInputModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: () => void;
  onDraw: () => void;
}

export function ImageInputModeModal({ isOpen, onClose, onImport, onDraw }: ImageInputModeModalProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md ${
          isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'
        }`}
        onClick={onClose}
      />

      <div
        className={`relative w-full max-w-sm bg-bg-secondary rounded-[2.25rem] p-7 shadow-2xl border border-border/5 ${
          isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
        }`}
      >
        <div className="flex items-center mb-6">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('canvasMode.back')}
          </button>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
            <h2 className="text-lg font-medium text-text-primary tracking-tight">{t('canvasMode.title')}</h2>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onImport}
            className="group flex flex-col items-center justify-center rounded-2xl bg-bg-primary/45 hover:bg-bg-primary/65 px-4 py-4 text-center transition-all"
          >
            <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
              </svg>
            </div>
            <div className="text-sm font-medium text-text-primary">{t('canvasMode.import')}</div>
          </button>

          <button
            type="button"
            onClick={onDraw}
            className="group flex flex-col items-center justify-center rounded-2xl bg-bg-primary/45 hover:bg-bg-primary/65 px-4 py-4 text-center transition-all"
          >
            <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20h9" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </div>
            <div className="text-sm font-medium text-text-primary">{t('canvasMode.draw')}</div>
          </button>
        </div>
      </div>
    </div>
  );
}
