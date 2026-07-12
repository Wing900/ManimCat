import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReferenceImage } from '../../types/api';
import { uploadReferenceImage } from '../../lib/api';
import { useI18n } from '../../i18n';
import { CanvasPreviewStrip } from './CanvasPreviewStrip';
import { CanvasToolbar } from './CanvasToolbar';
import { createPage, DEFAULT_COLOR, DEFAULT_WIDTH, ERASER_RADIUS, CANVAS_EXPORT_HEIGHT, CANVAS_EXPORT_WIDTH } from './constants';
import { eraseStrokeWithCircle, findStrokeAtPoint } from './canvas-geometry';
import { dataUrlToFile, drawGrid, drawStroke, getCanvasPoint, renderPageToDataUrl } from './canvas-render';
import type { CanvasPage, Point, PreviewImage, StrokeObject, ToolMode } from './types';

interface CanvasWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (images: ReferenceImage[]) => void;
}

function eraseAtPoint(strokes: StrokeObject[], point: Point, radius: number): StrokeObject[] {
  return strokes.flatMap((stroke) => eraseStrokeWithCircle(stroke, point, radius));
}

export function CanvasWorkspaceModal({ isOpen, onClose, onComplete }: CanvasWorkspaceModalProps) {
  const { t } = useI18n();
  const [pages, setPages] = useState<CanvasPage[]>([createPage()]);
  const [activePageId, setActivePageId] = useState<string>(() => pages[0].id);
  const [tool, setTool] = useState<ToolMode>('pen');
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [isBrushSettingsOpen, setIsBrushSettingsOpen] = useState(false);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_WIDTH);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [isPreviewConfirmOpen, setIsPreviewConfirmOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeIdRef = useRef<string | null>(null);
  const dragOriginRef = useRef<Point | null>(null);
  const isErasingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const firstPage = createPage();
    setPages([firstPage]);
    setActivePageId(firstPage.id);
    setTool('pen');
    setIsToolbarCollapsed(false);
    setIsBrushSettingsOpen(false);
    setColor(DEFAULT_COLOR);
    setStrokeWidth(DEFAULT_WIDTH);
    setSelectedStrokeId(null);
    setIsDirty(false);
    setIsDiscardConfirmOpen(false);
    setIsPreviewConfirmOpen(false);
    setIsExporting(false);
    setPreviewImages([]);
    activeStrokeIdRef.current = null;
    dragOriginRef.current = null;
    isErasingRef.current = false;
  }, [isOpen]);

  const activePageIndex = useMemo(() => pages.findIndex((page) => page.id === activePageId), [activePageId, pages]);
  const activePage = activePageIndex >= 0 ? pages[activePageIndex] : pages[0];

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activePage) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    drawGrid(ctx, CANVAS_EXPORT_WIDTH, CANVAS_EXPORT_HEIGHT);
    activePage.strokes.forEach((stroke) => drawStroke(ctx, stroke));

    if (selectedStrokeId) {
      const selected = activePage.strokes.find((stroke) => stroke.id === selectedStrokeId);
      if (selected) {
        const xs = selected.points.map((point) => point.x);
        const ys = selected.points.map((point) => point.y);
        const minX = Math.min(...xs) - selected.width - 12;
        const maxX = Math.max(...xs) + selected.width + 12;
        const minY = Math.min(...ys) - selected.width - 12;
        const maxY = Math.max(...ys) + selected.width + 12;
        ctx.save();
        ctx.strokeStyle = 'rgba(10, 132, 255, 0.72)';
        ctx.setLineDash([14, 8]);
        ctx.lineWidth = 2;
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        ctx.restore();
      }
    }

    if (tool === 'eraser') {
      ctx.save();
      ctx.strokeStyle = 'rgba(30, 30, 30, 0.18)';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(80, 80, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [activePage, selectedStrokeId, tool]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const updateActivePage = useCallback((updater: (page: CanvasPage) => CanvasPage) => {
    setPages((prev) => prev.map((page) => (page.id === activePageId ? updater(page) : page)));
  }, [activePageId]);

  const applyErase = useCallback((point: Point) => {
    updateActivePage((page) => ({
      ...page,
      strokes: eraseAtPoint(page.strokes, point, ERASER_RADIUS),
    }));
    setSelectedStrokeId(null);
    setIsDirty(true);
  }, [updateActivePage]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !activePage) {
      return;
    }

    const point = getCanvasPoint(event, canvas);
    canvas.setPointerCapture(event.pointerId);

    if (tool === 'pen') {
      const strokeId = crypto.randomUUID();
      activeStrokeIdRef.current = strokeId;
      const newStroke: StrokeObject = {
        id: strokeId,
        color,
        width: strokeWidth,
        points: [point],
      };
      updateActivePage((page) => ({ ...page, strokes: [...page.strokes, newStroke] }));
      setSelectedStrokeId(strokeId);
      setIsDirty(true);
      return;
    }

    if (tool === 'eraser') {
      isErasingRef.current = true;
      applyErase(point);
      return;
    }

    if (tool === 'select') {
      const target = findStrokeAtPoint(activePage.strokes, point);
      if (!target) {
        setSelectedStrokeId(null);
        activeStrokeIdRef.current = null;
        return;
      }
      setSelectedStrokeId(target.id);
      activeStrokeIdRef.current = target.id;
      dragOriginRef.current = point;
    }
  }, [activePage, applyErase, color, strokeWidth, tool, updateActivePage]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !activePage) {
      return;
    }

    const point = getCanvasPoint(event, canvas);

    if (tool === 'pen' && activeStrokeIdRef.current) {
      updateActivePage((page) => ({
        ...page,
        strokes: page.strokes.map((stroke) => (
          stroke.id === activeStrokeIdRef.current
            ? { ...stroke, points: [...stroke.points, point] }
            : stroke
        )),
      }));
      return;
    }

    if (tool === 'eraser' && isErasingRef.current) {
      applyErase(point);
      return;
    }

    if (tool === 'select' && activeStrokeIdRef.current && dragOriginRef.current) {
      const deltaX = point.x - dragOriginRef.current.x;
      const deltaY = point.y - dragOriginRef.current.y;
      dragOriginRef.current = point;
      updateActivePage((page) => ({
        ...page,
        strokes: page.strokes.map((stroke) => (
          stroke.id === activeStrokeIdRef.current
            ? {
                ...stroke,
                points: stroke.points.map((value) => ({ x: value.x + deltaX, y: value.y + deltaY })),
              }
            : stroke
        )),
      }));
      setIsDirty(true);
    }
  }, [activePage, applyErase, tool, updateActivePage]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (tool !== 'select') {
      activeStrokeIdRef.current = null;
    }
    dragOriginRef.current = null;
    isErasingRef.current = false;
  }, [tool]);

  const handleAddPage = useCallback(() => {
    const page = createPage();
    setPages((prev) => [...prev, page]);
    setActivePageId(page.id);
    setSelectedStrokeId(null);
    setIsDirty(true);
  }, []);

  const handleDeletePage = useCallback(() => {
    if (pages.length <= 1) {
      const firstPage = createPage();
      setPages([firstPage]);
      setActivePageId(firstPage.id);
      setSelectedStrokeId(null);
      setIsDirty(true);
      return;
    }

    const nextPages = pages.filter((page) => page.id !== activePageId);
    const nextActive = nextPages[Math.max(0, activePageIndex - 1)] || nextPages[0];
    setPages(nextPages);
    setActivePageId(nextActive.id);
    setSelectedStrokeId(null);
    setIsDirty(true);
  }, [activePageId, activePageIndex, pages]);

  const handlePreparePreview = useCallback(() => {
    setPreviewImages(pages.map((page) => ({ id: page.id, dataUrl: renderPageToDataUrl(page) })));
    setIsPreviewConfirmOpen(true);
  }, [pages]);

  const handleConfirmPreview = useCallback(async () => {
    if (previewImages.length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      const uploadedImages: ReferenceImage[] = [];
      for (let index = 0; index < previewImages.length; index += 1) {
        const preview = previewImages[index];
        const file = dataUrlToFile(preview.dataUrl, `canvas-page-${String(index + 1).padStart(2, '0')}.png`);
        const uploaded = await uploadReferenceImage(file);
        uploadedImages.push({ url: uploaded.url, detail: 'low' });
      }
      onComplete(uploadedImages);
      setIsPreviewConfirmOpen(false);
      onClose();
    } finally {
      setIsExporting(false);
    }
  }, [onClose, onComplete, previewImages]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[140] overflow-hidden bg-bg-primary animate-classic-entrance">
      <div className="absolute inset-0 bg-bg-primary/95" />
      <div className="absolute inset-0 canvas-transition-grid opacity-40" />

      <div className="relative flex h-full w-full">
        {/* 左侧工具栏容器 */}
        <div className="pointer-events-none absolute left-8 top-1/2 z-10 -translate-y-1/2">
          <CanvasToolbar
            tool={tool}
            isToolbarCollapsed={isToolbarCollapsed}
            isBrushSettingsOpen={isBrushSettingsOpen}
            color={color}
            strokeWidth={strokeWidth}
            onToggleCollapse={() => setIsToolbarCollapsed((prev) => !prev)}
            onSelectTool={setTool}
            onToggleBrushSettings={() => setIsBrushSettingsOpen((prev) => !prev)}
            onDeletePage={handleDeletePage}
            onAddPage={handleAddPage}
            onChangeColor={setColor}
            onChangeStrokeWidth={setStrokeWidth}
            t={t}
          />
        </div>

        {/* 顶部返回按钮 */}
        <div className="pointer-events-none absolute left-8 top-8 z-10">
          <button
            type="button"
            onClick={() => (isDirty ? setIsDiscardConfirmOpen(true) : onClose())}
            className="pointer-events-auto inline-flex items-center gap-2.5 rounded-full border border-border/5 bg-bg-secondary/80 px-5 py-3 text-sm font-medium text-text-secondary shadow-xl backdrop-blur-xl transition-all hover:text-text-primary hover:bg-bg-secondary"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            {t('canvas.back')}
          </button>
        </div>

        {/* 顶部确认按钮 */}
        <div className="pointer-events-none absolute right-8 top-8 z-10">
          <button
            type="button"
            onClick={handlePreparePreview}
            className="pointer-events-auto inline-flex items-center gap-2.5 rounded-full bg-accent px-6 py-3.5 text-sm font-bold text-white shadow-2xl shadow-accent/20 transition-all hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            {t('canvas.confirm')}
          </button>
        </div>

        {/* 画布主容器 */}
        <div className="flex h-full w-full items-center justify-center px-28 pb-32 pt-24">
          <div className="relative h-full w-full max-w-[1400px] overflow-hidden rounded-[32px] border border-border/5 bg-white shadow-[0_48px_120px_-32px_rgba(0,0,0,0.12)] transition-transform duration-700">
            <div className="pointer-events-none absolute inset-0 canvas-paper-grid opacity-60" />
            <canvas
              ref={canvasRef}
              width={CANVAS_EXPORT_WIDTH}
              height={CANVAS_EXPORT_HEIGHT}
              className="relative z-[1] h-full w-full touch-none cursor-crosshair"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>
        </div>

        {/* 底部预览条 */}
        <CanvasPreviewStrip
          pages={pages}
          activePageId={activePageId}
          selectedStrokeId={selectedStrokeId}
          onSelectPage={(pageId) => {
            setActivePageId(pageId);
            setSelectedStrokeId(null);
          }}
          onAddPage={handleAddPage}
          t={t}
        />
      </div>

      {/* 放弃确认弹窗 */}
      {isDiscardConfirmOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-primary/60 backdrop-blur-md animate-overlay-wash-in" onClick={() => setIsDiscardConfirmOpen(false)} />
          <div className="relative w-full max-w-lg rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl animate-modal-pop-in">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
                <h2 className="text-xl font-medium text-text-primary tracking-tight">{t('canvas.discardTitle')}</h2>
              </div>
              <button
                onClick={() => setIsDiscardConfirmOpen(false)}
                className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-text-secondary text-[15px] mb-10 leading-relaxed font-light">
              {t('canvas.discardDescription')}
            </p>

            <div className="flex gap-4">
              <button
                onClick={() => setIsDiscardConfirmOpen(false)}
                className="flex-1 py-4 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-2xl transition-all active:scale-95"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  setIsDiscardConfirmOpen(false);
                  onClose();
                }}
                className="flex-1 py-4 text-sm text-bg-primary bg-text-primary hover:opacity-90 rounded-2xl transition-all active:scale-95 shadow-lg shadow-black/10 font-medium"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导出预览弹窗 */}
      {isPreviewConfirmOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-primary/60 backdrop-blur-md animate-overlay-wash-in" onClick={() => !isExporting && setIsPreviewConfirmOpen(false)} />
          <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl animate-modal-pop-in">
            <div className="flex items-center justify-between mb-8 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
                <h2 className="text-xl font-medium text-text-primary tracking-tight">{t('canvas.previewConfirmTitle')}</h2>
              </div>
              <button
                onClick={() => !isExporting && setIsPreviewConfirmOpen(false)}
                className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-text-secondary text-[15px] mb-8 leading-relaxed font-light shrink-0">
              {t('canvas.previewConfirmDescription')}
            </p>

            <div className="grid gap-6 overflow-y-auto mb-10 px-1 py-2 md:grid-cols-2 lg:grid-cols-3">
              {previewImages.map((image, index) => (
                <div key={image.id} className="group overflow-hidden rounded-[1.75rem] border border-border/5 bg-bg-primary/50 transition-all hover:bg-bg-primary/80">
                  <div className="aspect-[16/10] overflow-hidden">
                    <img src={image.dataUrl} alt={t('canvas.previewImageAlt', { index: index + 1 })} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
                  </div>
                  <div className="flex items-center justify-between px-5 py-4 text-xs font-bold uppercase tracking-widest text-text-secondary/35">
                    <span>{t('canvas.previewItem', { index: index + 1 })}</span>
                    <span className="font-mono">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-4 shrink-0">
              <button
                type="button"
                onClick={() => setIsPreviewConfirmOpen(false)}
                disabled={isExporting}
                className="px-8 py-4 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-2xl transition-all active:scale-95 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmPreview}
                disabled={isExporting}
                className="px-10 py-4 text-sm text-bg-primary bg-text-primary hover:bg-accent-hover-rgb rounded-2xl transition-all active:scale-95 disabled:opacity-50 shadow-lg font-medium"
              >
                {isExporting ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {t('canvas.uploading')}
                  </div>
                ) : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
