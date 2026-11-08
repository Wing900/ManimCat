import { memo, useEffect, useRef } from 'react';
import { drawPage } from './canvas-render';
import { CANVAS_EXPORT_HEIGHT, CANVAS_EXPORT_WIDTH } from './constants';
import type { I18nContextValue } from '../../../shared/i18n/context';
import type { CanvasPage } from './types';

const PageThumbnail = memo(function PageThumbnail({ page }: { page: CanvasPage }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const ctx = ref.current?.getContext('2d');
      if (!ctx) return;
      ctx.save(); ctx.scale(160 / CANVAS_EXPORT_WIDTH, 90 / CANVAS_EXPORT_HEIGHT); drawPage(ctx, page); ctx.restore();
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);
  return <canvas ref={ref} width={160} height={90} className="h-full w-full" />;
});

interface CanvasPreviewStripProps {
  pages: CanvasPage[]; activePageId: string; onSelectPage: (pageId: string) => void; onAddPage: () => void; t: I18nContextValue['t'];
}

export function CanvasPreviewStrip({ pages, activePageId, onSelectPage, onAddPage, t }: CanvasPreviewStripProps) {
  return (
    <div className="pointer-events-none fixed bottom-7 left-1/2 z-10 max-w-[90vw] -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 overflow-x-auto rounded-[2rem] bg-bg-secondary/60 px-3 py-2.5 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.1)] backdrop-blur-2xl" aria-label={t('canvas.previewLabel')}>
        {pages.map((page, index) => {
          const isSelected = page.id === activePageId;
          return <div key={page.id} className="relative flex shrink-0 flex-col items-center gap-1.5">
            <button type="button" onClick={() => onSelectPage(page.id)} aria-label={t('canvas.previewItem', { index: index + 1 })} aria-pressed={isSelected}
              className={`relative h-[45px] w-20 overflow-hidden rounded-xl transition-all ${isSelected ? 'ring-2 ring-accent/40' : 'opacity-50 hover:opacity-100'}`}>
              <PageThumbnail page={page} />
            </button>
            <div className={`h-1 rounded-full bg-accent transition-all ${isSelected ? 'w-4 opacity-60' : 'w-0 opacity-0'}`} />
          </div>;
        })}
        <button type="button" onClick={onAddPage} aria-label={t('canvas.tool.addPage')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-dashed border-border/20 bg-bg-primary/20 text-text-secondary/60 hover:text-accent">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2.2} d="M12 6v12m-6-6h12" /></svg>
        </button>
      </div>
    </div>
  );
}
