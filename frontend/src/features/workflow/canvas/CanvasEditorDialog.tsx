import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n';
import { useModalTransition } from '../../../shared/hooks/useModalTransition';

interface Props {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
  disabled?: boolean;
}

export function CanvasEditorDialog({ title, onClose, onSubmit, children, disabled = false }: Props) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(true);
  const { shouldRender, isExiting } = useModalTransition(isOpen, 320);
  const ref = useRef<HTMLFormElement>(null);
  const completionRef = useRef<(() => void) | null>(null);

  const finish = (callback: () => void) => {
    if (completionRef.current) return;
    completionRef.current = callback;
    setIsOpen(false);
  };

  useEffect(() => {
    if (!shouldRender) completionRef.current?.();
  }, [shouldRender]);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLElement>('input')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  if (!shouldRender) return null;
  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center p-4" inert={!isOpen}>
      <div className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md ${isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'}`}
        onPointerDown={() => finish(onClose)} />
      <form ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`relative max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-border/10 bg-bg-secondary p-6 text-text-primary shadow-2xl ${isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'}`}
        onSubmit={(event) => { event.preventDefault(); if (!disabled) finish(onSubmit); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(onClose); }
          if (event.key === 'Tab') {
            const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea') ?? []);
            const first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <h2 className="mb-5 text-lg font-medium">{title}</h2>
        {children}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => finish(onClose)} className="rounded-xl bg-bg-primary px-5 py-2.5 text-sm text-text-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={disabled} className="rounded-xl bg-accent px-5 py-2.5 text-sm text-white disabled:opacity-40">{t('common.confirm')}</button>
        </div>
      </form>
    </div>
  );
}
