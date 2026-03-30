import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useModalTransition } from '../../hooks/useModalTransition';
import { useI18n } from '../../i18n';
import { CLOSED_IMAGE_CONTEXT_MENU, ImageContextMenu } from './context-menu';
import { copyImageAssetToClipboard, exportImageAsset, type ExportFormat } from './image-asset';

interface ImageLightboxProps {
  isOpen: boolean;
  activeImage?: string;
  activeIndex: number;
  total: number;
  zoom: number;
  variant?: 'dark' | 'studio-light';
  minZoom?: number;
  maxZoom?: number;
  onZoomChange: (nextZoom: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}

export function ImageLightbox({
  isOpen,
  activeImage,
  activeIndex,
  total,
  zoom,
  variant = 'dark',
  minZoom = 0.5,
  maxZoom = 4,
  onZoomChange,
  onPrev,
  onNext,
  onClose,
}: ImageLightboxProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen, 320);
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [transformOrigin, setTransformOrigin] = useState('center center');
  const [contextMenu, setContextMenu] = useState(CLOSED_IMAGE_CONTEXT_MENU);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [copyingFormat, setCopyingFormat] = useState<'png' | 'svg' | null>(null);
  const isStudioLight = variant === 'studio-light';

  useEffect(() => {
    if (!shouldRender) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setContextMenu(CLOSED_IMAGE_CONTEXT_MENU);
        onClose();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setContextMenu(CLOSED_IMAGE_CONTEXT_MENU);
        onPrev?.();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setContextMenu(CLOSED_IMAGE_CONTEXT_MENU);
        onNext?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, onNext, onPrev, shouldRender]);

  useEffect(() => {
    if (!shouldRender || typeof document === 'undefined') {
      return undefined;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender) {
      setTransformOrigin('center center');
      setContextMenu(CLOSED_IMAGE_CONTEXT_MENU);
      setExportingFormat(null);
      setCopyingFormat(null);
    }
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      shellRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [shouldRender]);

  const imageScaleStyle = {
    transform: `scale(${zoom})`,
    transformOrigin,
  };

  const handleStepZoom = (delta: number) => {
    const nextZoom = roundZoom(clampZoom(zoom + delta, minZoom, maxZoom));
    onZoomChange(nextZoom);
  };

  const handleStudioWheel = (event: WheelEvent) => {
    event.preventDefault();

    const image = imageRef.current;
    const viewport = viewportRef.current;
    if (!image || !viewport) {
      return;
    }

    const nextZoom = roundZoom(clampZoom(zoom + (event.deltaY < 0 ? 0.12 : -0.12), minZoom, maxZoom));
    if (nextZoom === zoom) {
      return;
    }

    const imageRect = image.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const normalizedX = clampRatio((event.clientX - imageRect.left) / Math.max(imageRect.width, 1));
    const normalizedY = clampRatio((event.clientY - imageRect.top) / Math.max(imageRect.height, 1));
    const originX = `${(normalizedX * 100).toFixed(2)}%`;
    const originY = `${(normalizedY * 100).toFixed(2)}%`;
    const pointerOffsetX = event.clientX - viewportRect.left + viewport.scrollLeft;
    const pointerOffsetY = event.clientY - viewportRect.top + viewport.scrollTop;
    const zoomRatio = nextZoom / Math.max(zoom, 0.0001);

    setTransformOrigin(`${originX} ${originY}`);
    onZoomChange(nextZoom);

    window.requestAnimationFrame(() => {
      const nextScrollLeft = pointerOffsetX * zoomRatio - (event.clientX - viewportRect.left);
      const nextScrollTop = pointerOffsetY * zoomRatio - (event.clientY - viewportRect.top);
      viewport.scrollLeft = Math.max(0, nextScrollLeft);
      viewport.scrollTop = Math.max(0, nextScrollTop);
    });
  };

  useEffect(() => {
    if (!shouldRender) {
      return undefined;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      handleStudioWheel(event);
    };

    viewport.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      viewport.removeEventListener('wheel', handleNativeWheel);
    };
  }, [handleStudioWheel, shouldRender, variant]);

  if (!shouldRender || !activeImage) {
    return null;
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleExport = async (format: ExportFormat) => {
    if (!activeImage || exportingFormat) {
      return;
    }

    setContextMenu(CLOSED_IMAGE_CONTEXT_MENU);
    setExportingFormat(format);
    try {
      await exportImageAsset({
        source: activeImage,
        format,
        index: activeIndex,
      });
    } catch (error) {
      console.error(`Failed to export ${format}`, error);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleCopy = async (format: 'png' | 'svg') => {
    if (!activeImage || copyingFormat) {
      return;
    }

    setContextMenu(CLOSED_IMAGE_CONTEXT_MENU);
    setCopyingFormat(format);
    try {
      await copyImageAssetToClipboard({
        source: activeImage,
        format,
      });
    } catch (error) {
      console.error(`Failed to copy ${format}`, error);
    } finally {
      setCopyingFormat(null);
    }
  };

  if (isStudioLight) {
    return createPortal(
      <>
        <div
          ref={shellRef}
          tabIndex={-1}
          className={`fixed inset-0 z-[180] overflow-hidden bg-white/30 text-text-primary backdrop-blur-2xl ${
            isExiting ? 'animate-fade-out-soft' : 'animate-fade-in-soft'
          }`}
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.94),_rgba(255,255,255,0.5)_42%,_rgba(244,244,245,0.26)_100%)]" />
            <div className="absolute left-[-8%] top-[-10%] h-[38vh] w-[38vw] rounded-full bg-white/55 blur-[110px]" />
            <div className="absolute bottom-[-16%] right-[-6%] h-[42vh] w-[34vw] rounded-full bg-slate-200/45 blur-[120px]" />
          </div>

          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default"
          />

          <button
            type="button"
            onClick={onClose}
            className="absolute right-6 top-5 z-20 text-[11px] font-medium uppercase tracking-[0.28em] text-text-secondary/55 transition hover:text-text-primary"
          >
            {t('common.close')}
          </button>

          <div
            ref={viewportRef}
            className="relative z-10 flex h-full w-full items-center justify-center overflow-auto p-4 sm:p-6"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onClose();
              }
            }}
          >
            <img
              ref={imageRef}
              src={activeImage}
              alt={t('image.lightboxAlt', { index: activeIndex + 1 })}
              className={`max-w-none select-none drop-shadow-[0_30px_80px_rgba(148,163,184,0.28)] ${
                isExiting ? 'animate-fade-out-soft' : 'animate-fade-in-soft'
              }`}
              style={{
                ...imageScaleStyle,
                maxWidth: 'min(98vw, 2200px)',
                maxHeight: 'min(95vh, 1800px)',
              }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={handleContextMenu}
            />
          </div>
        </div>
        <ImageContextMenu
          state={contextMenu}
          variant={variant}
          title={t('image.exportMenuTitle')}
          items={[
            {
              key: 'copy-png',
              label: copyingFormat === 'png' ? t('image.copying') : t('image.copyPng'),
              busy: copyingFormat === 'png',
              onClick: () => void handleCopy('png'),
            },
            {
              key: 'copy-svg',
              label: copyingFormat === 'svg' ? t('image.copying') : t('image.copySvg'),
              busy: copyingFormat === 'svg',
              onClick: () => void handleCopy('svg'),
            },
            {
              key: 'export-png',
              label: exportingFormat === 'png' ? t('image.exporting') : t('image.exportPng'),
              busy: exportingFormat === 'png',
              onClick: () => void handleExport('png'),
            },
            {
              key: 'export-svg',
              label: exportingFormat === 'svg' ? t('image.exporting') : t('image.exportSvg'),
              busy: exportingFormat === 'svg',
              onClick: () => void handleExport('svg'),
            },
            {
              key: 'export-pdf',
              label: exportingFormat === 'pdf' ? t('image.exporting') : t('image.exportPdf'),
              busy: exportingFormat === 'pdf',
              onClick: () => void handleExport('pdf'),
            },
          ]}
          onClose={() => setContextMenu(CLOSED_IMAGE_CONTEXT_MENU)}
        />
      </>,
      document.body,
    );
  }

  return createPortal(
    <>
      <div
        ref={shellRef}
        tabIndex={-1}
        className="fixed inset-0 z-[180] flex flex-col bg-black/85 text-white/90 backdrop-blur-sm"
      >
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="absolute inset-0 h-full w-full cursor-default"
        />
        <div className="relative z-10 flex items-center justify-between px-5 py-3 text-white/90">
          <div className="text-xs">
            {t('image.lightboxTitle', { current: activeIndex + 1, total })}
          </div>
          <div className="flex items-center gap-3">
            {onPrev ? (
              <button type="button" onClick={onPrev} className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25">
                ←
              </button>
            ) : null}
            {onNext ? (
              <button type="button" onClick={onNext} className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25">
                →
              </button>
            ) : null}
            <button type="button" onClick={() => handleStepZoom(-0.1)} className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25">
              -
            </button>
            <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => handleStepZoom(0.1)} className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25">
              +
            </button>
            <button type="button" onClick={onClose} className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25">
              {t('common.close')}
            </button>
          </div>
        </div>
        <div
          ref={viewportRef}
          className="relative z-10 flex flex-1 items-center justify-center overflow-auto px-6 pb-6"
        >
          <div
            className="flex h-full w-full items-center justify-center"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onClose();
              }
            }}
          >
          <img
            ref={imageRef}
            src={activeImage}
            alt={t('image.lightboxAlt', { index: activeIndex + 1 })}
            className="max-w-none"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={handleContextMenu}
          />
          </div>
        </div>
      </div>
      <ImageContextMenu
        state={contextMenu}
        variant={variant}
        title={t('image.exportMenuTitle')}
        items={[
          {
            key: 'copy-png',
            label: copyingFormat === 'png' ? t('image.copying') : t('image.copyPng'),
            busy: copyingFormat === 'png',
            onClick: () => void handleCopy('png'),
          },
          {
            key: 'copy-svg',
            label: copyingFormat === 'svg' ? t('image.copying') : t('image.copySvg'),
            busy: copyingFormat === 'svg',
            onClick: () => void handleCopy('svg'),
          },
          {
            key: 'export-png',
            label: exportingFormat === 'png' ? t('image.exporting') : t('image.exportPng'),
            busy: exportingFormat === 'png',
            onClick: () => void handleExport('png'),
          },
          {
            key: 'export-svg',
            label: exportingFormat === 'svg' ? t('image.exporting') : t('image.exportSvg'),
            busy: exportingFormat === 'svg',
            onClick: () => void handleExport('svg'),
          },
          {
            key: 'export-pdf',
            label: exportingFormat === 'pdf' ? t('image.exporting') : t('image.exportPdf'),
            busy: exportingFormat === 'pdf',
            onClick: () => void handleExport('pdf'),
          },
        ]}
        onClose={() => setContextMenu(CLOSED_IMAGE_CONTEXT_MENU)}
      />
    </>,
    document.body,
  );
}

function clampZoom(value: number, minZoom: number, maxZoom: number) {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

function roundZoom(value: number) {
  return Math.round(value * 100) / 100;
}

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}
