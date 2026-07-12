// AI 修改对话框

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { useModalTransition } from '../hooks/useModalTransition';

interface AiModifyModalProps {
  isOpen: boolean;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export function AiModifyModal({ isOpen, loading = false, onClose, onSubmit }: AiModifyModalProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (isOpen) {
      setDraft('');
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* 沉浸式背景 */}
      <div 
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md ${
          isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'
        }`} 
        onClick={onClose} 
      />

      {/* 模态框主体 */}
      <div className={`relative w-full max-w-lg bg-bg-secondary rounded-[2.5rem] p-10 shadow-2xl border border-border/5 ${
        isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
      }`}>
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
            <h2 className="text-xl font-medium text-text-primary tracking-tight">{t('aiModify.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-text-secondary text-[15px] mb-8 leading-relaxed font-light">
          {t('aiModify.description')}
        </p>

        <div className="relative mb-10 group">
          <textarea
            id="aiModifyInput"
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('aiModify.placeholder')}
            className="w-full px-6 py-6 bg-bg-secondary/50 border border-border/5 rounded-3xl text-base text-text-primary placeholder-text-secondary/30 focus:outline-none focus:border-accent-rgb/30 focus:bg-bg-secondary/80 transition-all resize-none shadow-inner"
          />
          <label
            htmlFor="aiModifyInput"
            className="absolute right-6 -bottom-3 px-3 py-1 bg-bg-secondary border border-border/5 rounded-full text-[10px] uppercase tracking-widest text-text-secondary/40 group-focus-within:text-accent-rgb/60 group-focus-within:border-accent-rgb/20 transition-all"
          >
            {t('aiModify.label')}
          </label>
        </div>

        <div className="flex gap-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-4 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-2xl transition-all active:scale-95 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => onSubmit(draft.trim())}
            disabled={loading || draft.trim().length === 0}
            className="flex-1 py-4 text-sm text-bg-primary bg-text-primary hover:bg-accent-hover-rgb rounded-2xl transition-all active:scale-95 disabled:opacity-50 shadow-lg font-medium"
          >
            {loading ? t('aiModify.submitting') : t('aiModify.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
