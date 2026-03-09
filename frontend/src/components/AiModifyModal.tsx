// AI 修改对话框

import { useI18n } from '../i18n';

interface AiModifyModalProps {
  isOpen: boolean;
  value: string;
  loading?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function AiModifyModal({ isOpen, value, loading = false, onChange, onClose, onSubmit }: AiModifyModalProps) {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-bg-secondary rounded-2xl p-6 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <h2 className="text-lg font-medium text-text-primary">{t('aiModify.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-primary/50 rounded-full transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-text-secondary text-sm mb-4">
          {t('aiModify.description')}
        </p>

        <div className="relative mb-6">
          <label
            htmlFor="aiModifyInput"
            className="absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary"
          >
            {t('aiModify.label')}
          </label>
          <textarea
            id="aiModifyInput"
            rows={5}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('aiModify.placeholder')}
            className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all resize-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary bg-bg-primary hover:bg-bg-tertiary rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onSubmit}
            disabled={loading || value.trim().length === 0}
            className="flex-1 px-4 py-2.5 text-sm text-white bg-accent hover:bg-accent-hover rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('aiModify.submitting') : t('aiModify.submit')}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          0% {
            opacity: 0;
            transform: scale(0.95);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-fade-in {
          animation: fadeIn 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

