import { useI18n } from '../../../shared/i18n';

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function CanvasHistoryControls({ canUndo, canRedo, onUndo, onRedo }: Props) {
  const { t } = useI18n();
  return (
    <div className="absolute left-1/2 top-8 z-10 flex -translate-x-1/2 gap-1 rounded-2xl border border-border/5 bg-bg-secondary/80 p-1 shadow-lg backdrop-blur-xl" role="group" aria-label={t('canvas.history')}>
      {([
        { label: t('canvas.undo'), enabled: canUndo, onClick: onUndo, redo: false },
        { label: t('canvas.redo'), enabled: canRedo, onClick: onRedo, redo: true },
      ]).map(({ label, enabled, onClick, redo }) => (
        <button key={label} type="button" disabled={!enabled} onClick={onClick}
          aria-label={label} title={`${label} (Ctrl/⌘ ${redo ? 'Shift+Z' : 'Z'})`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-primary/80 hover:text-text-primary disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary">
          <svg className={`h-4 w-4 ${redo ? '-scale-x-100' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 5-5 5 5 5M4 10h9a7 7 0 0 1 7 7v2" />
          </svg>
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
