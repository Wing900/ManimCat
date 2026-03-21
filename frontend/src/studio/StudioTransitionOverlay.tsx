import { useI18n } from '../i18n';

interface StudioTransitionOverlayProps {
  visible: boolean;
  isExiting?: boolean;
}

function PawPrint({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <g fill="currentColor">
        <ellipse cx="20" cy="18" rx="6" ry="8" transform="rotate(-18 20 18)" />
        <ellipse cx="32" cy="13" rx="6" ry="8" />
        <ellipse cx="44" cy="18" rx="6" ry="8" transform="rotate(18 44 18)" />
        <ellipse cx="18" cy="31" rx="5" ry="7" transform="rotate(-30 18 31)" />
        <path d="M32 28c-10 0-18 7-18 16 0 7 6 11 11 11 3 0 5-1 7-3 2 2 4 3 7 3 5 0 11-4 11-11 0-9-8-16-18-16Z" />
      </g>
    </svg>
  );
}

export function StudioTransitionOverlay({ visible, isExiting }: StudioTransitionOverlayProps) {
  const { t } = useI18n();

  if (!visible) {
    return null;
  }

  return (
    <div className={`pointer-events-none fixed inset-0 z-[100] overflow-hidden bg-bg-primary ${
      isExiting ? 'studio-transition-exit' : 'studio-transition-enter'
    }`}>
      {/* 沉浸式遮盖：全覆盖面板 */}
      <div className={`absolute inset-0 bg-bg-primary ${
        isExiting ? 'studio-cover-full-exit' : 'studio-cover-full'
      }`} />
      
      {/* 动态网格背景 */}
      <div className="absolute left-0 top-0 h-full w-full studio-transition-grid" />
      
      {/* 居中的极简内容 */}
      <div className={`relative flex h-full flex-col items-center justify-center gap-12 transition-opacity duration-700 ${
        isExiting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}>
        <div className="flex items-end gap-6 text-text-primary/15">
          <PawPrint className="h-10 w-10 studio-paw-print studio-paw-print-1" />
          <PawPrint className="h-14 w-14 studio-paw-print studio-paw-print-2" />
          <PawPrint className="h-12 w-12 studio-paw-print studio-paw-print-3" />
        </div>

        <div className="flex flex-col items-center gap-4">
          <p className="text-[12px] uppercase tracking-[0.5em] text-text-secondary/50 font-light">
            {t('studio.loading')}
          </p>
          <div className="studio-transition-line h-px w-32 bg-text-primary/20" />
        </div>
      </div>
    </div>
  );
}
