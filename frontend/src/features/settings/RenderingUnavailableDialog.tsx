import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type TranslationKey } from '../../shared/i18n';
import { useModalTransition } from '../../shared/hooks/useModalTransition';

interface RenderingUnavailableDialogProps {
  message: TranslationKey;
  onClose: () => void;
}

/** Native modal semantics contain focus and make the settings behind it inert. */
export function RenderingUnavailableDialog({ message, onClose }: RenderingUnavailableDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  const [isOpen, setIsOpen] = useState(true);
  const { shouldRender, isExiting } = useModalTransition(isOpen);
  const requestClose = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!shouldRender) onClose();
  }, [onClose, shouldRender]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    confirmRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg overflow-visible border-0 bg-transparent p-0 text-text-primary backdrop:bg-bg-primary/60 backdrop:backdrop-blur-md"
    >
      <div
        inert={!isOpen}
        className={`relative w-full rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl ${
          isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
        }`}
      >
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent/40" />
            <h2 id={titleId} className="text-xl font-medium tracking-tight text-text-primary">
              {t('settings.nav.rendering')}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t('common.close')}
            className="rounded-2xl p-2.5 text-text-secondary/50 transition-all hover:bg-bg-primary/50 hover:text-text-primary"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p id={messageId} className="mb-10 text-[15px] font-light leading-relaxed text-text-secondary">
          {t(message)}
        </p>
        <div className="flex gap-4">
          <button
            ref={confirmRef}
            type="button"
            onClick={requestClose}
            className="flex-1 rounded-2xl bg-text-primary py-4 text-sm font-medium text-bg-primary shadow-lg shadow-black/10 transition-all hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
