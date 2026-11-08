import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../../shared/i18n';
import { CANVAS_EXPORT_HEIGHT, CANVAS_EXPORT_WIDTH, CANVAS_PAPER_COLOR } from './constants';
import type { TextObject } from './objects/types';
import { getTransform, toLocalPoint } from './objects/object-transform';
import { getCanvasPoint } from './canvas-coordinates';

interface Props {
  object: TextObject;
  onChange: (object: TextObject) => void;
  onDone: () => void;
  onCancel: (original: TextObject) => void;
}

/** An inline editor in the same coordinate system as the paper. */
export function CanvasTextEditor({ object, onChange, onDone, onCancel }: Props) {
  const { t } = useI18n();
  const [original] = useState(object);
  const [fontInput, setFontInput] = useState(String(object.fontSize));
  const [scale, setScale] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resizeRef = useRef<{ pointerId: number; localX: number; width: number } | null>(null);
  const boxWidth = object.boxWidth ?? 300;
  const transform = getTransform(object);

  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / CANVAS_EXPORT_WIDTH));
    observer.observe(parent);
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(original.text.length, original.text.length);
    return () => observer.disconnect();
  }, [original.text.length]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.max(object.fontSize * scale * 1.3 + 16, input.scrollHeight)}px`;
  }, [object.text, object.fontSize, boxWidth, scale]);

  useEffect(() => {
    const finishOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onDone();
    };
    document.addEventListener('pointerdown', finishOutside, true);
    return () => document.removeEventListener('pointerdown', finishOutside, true);
  }, [onDone]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20" style={{ transformOrigin: '0 0', transform: `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e * scale}, ${transform.f * scale})` }}>
      <div ref={rootRef} className="pointer-events-auto absolute rounded-lg border border-accent shadow-lg"
        style={{ left: `calc(${object.position.x / CANVAS_EXPORT_WIDTH * 100}% - 8px)`, top: `calc(${object.position.y / CANVAS_EXPORT_HEIGHT * 100}% - 8px)`, width: boxWidth * scale + 16, backgroundColor: CANVAS_PAPER_COLOR }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); onCancel(original); }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onDone(); }
        }}>
        <textarea ref={inputRef} value={object.text} rows={1} maxLength={4000} aria-label={t('canvas.textContent')}
          placeholder={t('canvas.textPlaceholder')}
          onChange={(event) => onChange({ ...object, text: event.target.value })}
          className="block w-full resize-none rounded-lg border-0 bg-transparent p-2 outline-none"
          style={{ fontFamily: 'sans-serif', fontSize: object.fontSize * scale, lineHeight: 1.3, color: object.color, wordBreak: 'break-all', overflowWrap: 'anywhere', maxHeight: Math.max(40, (CANVAS_EXPORT_HEIGHT - object.position.y - 10) * scale) }} />
        <div className={`absolute flex min-w-max items-center gap-2 rounded-lg border border-border/10 bg-bg-secondary px-2 py-1.5 text-xs text-text-primary shadow-lg ${object.position.x > CANVAS_EXPORT_WIDTH * 0.65 ? 'right-0' : 'left-0'} ${object.position.y > CANVAS_EXPORT_HEIGHT * 0.65 ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'}`}>
          <label className="flex items-center gap-1.5">{t('canvas.fontSize')}
            <input type="number" min={12} max={160} value={fontInput} aria-label={t('canvas.fontSize')}
              onChange={(event) => {
                setFontInput(event.target.value);
                const size = Number(event.target.value);
                if (size >= 12 && size <= 160) onChange({ ...object, fontSize: size });
              }} onBlur={() => setFontInput(String(object.fontSize))} className="w-14 rounded-md bg-bg-primary px-1.5 py-1" />
          </label>
          <button type="button" onClick={onDone} aria-label={t('common.confirm')} title={t('common.confirm')} className="rounded-md px-2 py-1 text-accent hover:bg-bg-primary">✓</button>
          <button type="button" onClick={() => onCancel(original)} aria-label={t('common.cancel')} title={t('common.cancel')} className="rounded-md px-2 py-1 hover:bg-bg-primary">×</button>
        </div>
        <button type="button" aria-label={t('canvas.textResize')} title={t('canvas.textResize')}
          className="absolute -bottom-1 -right-1 h-3 w-3 touch-none cursor-ew-resize rounded-sm border border-white bg-accent"
          onPointerDown={(event) => {
            event.preventDefault();
            const canvas = rootRef.current?.parentElement?.parentElement?.querySelector('canvas');
            if (!canvas) return;
            resizeRef.current = { pointerId: event.pointerId, localX: toLocalPoint(object, getCanvasPoint(event, canvas)).x, width: boxWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const resize = resizeRef.current;
            if (!resize || event.pointerId !== resize.pointerId) return;
            const canvas = rootRef.current?.parentElement?.parentElement?.querySelector('canvas');
            if (!canvas) return;
            const local = toLocalPoint(object, getCanvasPoint(event, canvas));
            const nextWidth = Math.max(80, Math.min(CANVAS_EXPORT_WIDTH - object.position.x - 12, resize.width + local.x - resize.localX));
            onChange({ ...object, boxWidth: nextWidth });
          }}
          onPointerUp={(event) => {
            resizeRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { resizeRef.current = null; }}
          onLostPointerCapture={() => { resizeRef.current = null; }} />
      </div>
    </div>
  );
}
