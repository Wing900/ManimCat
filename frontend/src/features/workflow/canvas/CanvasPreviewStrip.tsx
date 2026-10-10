import { renderPageToDataUrl } from './canvas-render';
import type { I18nContextValue } from '../../../shared/i18n/context';
import type { CanvasPage } from './types';

interface CanvasPreviewStripProps {
  pages: CanvasPage[];
  activePageId: string;
  selectedStrokeId: string | null;
  onSelectPage: (pageId: string) => void;
  onAddPage: () => void;
  t: I18nContextValue['t'];
}

export function CanvasPreviewStrip({
  pages,
  activePageId,
  selectedStrokeId,
  onSelectPage,
  onAddPage,
}: CanvasPreviewStripProps) {
  return (
    <div className="pointer-events-none fixed bottom-7 left-1/2 z-10 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-4 rounded-full bg-bg-secondary/40 px-3 py-2.5 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.1)] backdrop-blur-2xl transition-all hover:bg-bg-secondary/50">
        <div className="flex items-center gap-2.5 px-1">
          {pages.map((page) => {
            const isSelected = page.id === activePageId;
            return (
              <div key={page.id} className="relative flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSelectPage(page.id)}
                  className={`group relative h-11 w-20 overflow-hidden rounded-[14px] transition-all duration-500 ${
                    isSelected
                      ? 'scale-[0.95] bg-bg-secondary ring-2 ring-accent/20'
                      : 'opacity-40 hover:opacity-100 hover:scale-[0.98]'
                  }`}
                >
                  <img 
                    src={renderPageToDataUrl(page, isSelected ? selectedStrokeId : null)} 
                    alt="" 
                    className="h-full w-full object-cover" 
                  />
                  <div className={`absolute inset-0 bg-white/5 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                </button>
                {/* 极简指示点 */}
                <div className={`h-1 rounded-full bg-accent transition-all duration-500 ${isSelected ? 'w-4 opacity-60' : 'w-0 opacity-0'}`} />
              </div>
            );
          })}

          <div className="mx-1 h-6 w-px bg-border/5" />

          <button
            type="button"
            onClick={onAddPage}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border/20 bg-bg-primary/20 text-text-secondary/40 transition-all hover:border-accent/40 hover:bg-bg-primary/50 hover:text-accent/60"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 6v12m-6-6h12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
