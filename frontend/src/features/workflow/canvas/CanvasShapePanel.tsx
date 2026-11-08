import { useI18n } from '../../../shared/i18n';
import type { ShapeKind } from './types';

const SHAPES: { kind: ShapeKind; path: string }[] = [
  { kind: 'circle', path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18' },
  { kind: 'ellipse', path: 'M2 12a10 6 0 1 0 20 0 10 6 0 1 0-20 0' },
  { kind: 'line', path: 'M4 20 20 4' },
  { kind: 'arrow', path: 'M4 20 20 4M8 4h12v12' },
  { kind: 'rectangle', path: 'M3 5h18v14H3Z' },
  { kind: 'triangle', path: 'm12 3 10 18H2Z' },
  { kind: 'polygon', path: 'm3 16 4-12 11 2 4 12-11 4Z' },
  { kind: 'text', path: 'M4 5h16M12 5v15M8 20h8' },
  { kind: 'function', path: 'M3 12h18M12 3v18M3 4q9 29 18 0' },
];

export function CanvasShapePanel({ shape, onSelect, onClose }: { shape: ShapeKind; onSelect: (shape: ShapeKind) => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="absolute left-[calc(100%+16px)] top-0 w-64 rounded-[28px] border border-border/5 bg-bg-secondary/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between text-sm text-text-primary">
        {t('canvas.tool.shapes')}
        <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="rounded-lg px-2 py-1 hover:bg-bg-primary">×</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SHAPES.map(({ kind, path }) => (
          <button type="button" key={kind} onClick={() => onSelect(kind)} aria-pressed={shape === kind}
            className={`flex flex-col items-center gap-2 rounded-xl px-1 py-3 text-xs transition-colors ${shape === kind ? 'bg-accent text-white' : 'bg-bg-primary/60 text-text-secondary hover:text-text-primary'}`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
            {t(`canvas.shape.${kind}`)}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-secondary">{t(shape === 'polygon' ? 'canvas.polygonHint' : shape === 'text' || shape === 'function' ? 'canvas.placeHint' : 'canvas.dragHint')}</p>
    </div>
  );
}
