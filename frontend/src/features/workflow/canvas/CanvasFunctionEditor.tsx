import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../shared/i18n';
import { CanvasEditorDialog } from './CanvasEditorDialog';
import { drawFunctionPlot } from './plot/render';
import { validatePlot } from './plot/sampling';
import type { FunctionPlotObject } from './objects/types';

const RANGE_KEYS = ['xMin', 'xMax', 'yMin', 'yMax'] as const;

export function CanvasFunctionEditor({ object, onSave, onClose }: {
  object: FunctionPlotObject; onSave: (object: FunctionPlotObject) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [expression, setExpression] = useState(object.expression);
  const [range, setRange] = useState(() => Object.fromEntries(RANGE_KEYS.map((key) => [key, String(object[key])])) as Record<typeof RANGE_KEYS[number], string>);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const result = useMemo(() => {
    const next: FunctionPlotObject = {
      ...object, expression,
      xMin: range.xMin.trim() ? Number(range.xMin) : NaN, xMax: range.xMax.trim() ? Number(range.xMax) : NaN,
      yMin: range.yMin.trim() ? Number(range.yMin) : NaN, yMax: range.yMax.trim() ? Number(range.yMax) : NaN,
    };
    try { validatePlot(next); return next; } catch { return null; }
  }, [object, expression, range]);
  useEffect(() => {
    const ctx = previewRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 600, 340);
    if (result) drawFunctionPlot(ctx, { ...result, bounds: { x: 10, y: 30, width: 580, height: 300 } });
  }, [result]);
  return (
    <CanvasEditorDialog title={t('canvas.shape.function')} onClose={onClose} disabled={!result} onSubmit={() => { if (result) onSave(result); }}>
      <label className="block text-sm">y =
        <input value={expression} maxLength={256} spellCheck={false} onChange={(e) => setExpression(e.target.value)}
          placeholder="sin(x)" className="ml-3 w-4/5 rounded-xl border border-border/10 bg-bg-primary p-3 font-mono" />
      </label>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('canvas.functionHint')}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {RANGE_KEYS.map((key) => <label key={key} className="text-xs text-text-secondary">{t(`canvas.plot.${key}`)}
          <input type="number" step="any" value={range[key]} onChange={(e) => setRange((prev) => ({ ...prev, [key]: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border/10 bg-bg-primary p-2 text-text-primary" />
        </label>)}
      </div>
      {!result && <p role="alert" className="mb-3 text-sm text-rose-500">{t('canvas.plot.invalid')}</p>}
      <canvas ref={previewRef} width={600} height={340} aria-label={t('canvas.plot.preview')} className="mt-4 w-full rounded-xl bg-[#fffefb]" />
    </CanvasEditorDialog>
  );
}
