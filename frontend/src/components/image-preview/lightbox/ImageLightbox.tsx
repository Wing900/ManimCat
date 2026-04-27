import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useModalTransition } from '../../../hooks/useModalTransition';
import { useI18n } from '../../../i18n';
import { ImageContextMenu } from '../context-menu';
import { DEFAULT_COLOR, DEFAULT_WIDTH } from '../../canvas/constants';
import { useLightboxCamera } from '../use-lightbox-camera';
import { LightboxStage } from './LightboxStage';
import { LightboxToolbar } from './LightboxToolbar';
import { AnnotationToolbar } from './AnnotationToolbar';
import { StudioGradientOverlay } from './LightboxBackground';
import { buildAnnotatedFilename } from './utils';
import { useLightboxKeyboard } from './useLightboxKeyboard';
import { useZoomTimingLogger } from './useZoomTimingLogger';
import { useBodyScrollLock } from './useBodyScrollLock';
import { useLightboxExport } from './useLightboxExport';

interface ImageLightboxProps {
  isOpen: boolean;
  activeImage?: string;
  activeIndex: number;
  total: number;
  initialZoom?: number;
  editableFilename?: string;
  appearance?: 'default' | 'studio';
  baseScaleMode?: 'fit' | 'cover';
  baseScaleBias?: number;
  minZoom?: number;
  maxZoom?: number;
  zoomDisplayScale?: number;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onCommitAnnotatedImage?: (attachment: { file: File; filename: string }) => Promise<void> | void;
}

export function ImageLightbox({
  isOpen,
  activeImage,
  activeIndex,
  total,
  initialZoom = 1,
  editableFilename,
  appearance = 'default',
  baseScaleMode = 'fit',
  baseScaleBias = 1,
  minZoom = 0.5,
  maxZoom = 4,
  zoomDisplayScale = 1,
  onPrev,
  onNext,
  onClose,
  onCommitAnnotatedImage,
}: ImageLightboxProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen, 320);
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<'pen' | 'eraser' | 'pan'>('pen');
  const [annotationColor, setAnnotationColor] = useState(DEFAULT_COLOR);
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = useState(DEFAULT_WIDTH);
  const [isBrushSettingsOpen, setIsBrushSettingsOpen] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);
  const isStudioAppearance = appearance === 'studio';

  const {
    contextMenu,
    exportingFormat,
    copyingFormat,
    closeContextMenu,
    openContextMenu,
    handleExport,
    handleCopy,
    reset: resetExport,
  } = useLightboxExport(activeImage, activeIndex);

  const { handleTrackedImageLoad, setPendingZoomTiming } = useZoomTimingLogger({
    shouldRender,
    activeImage,
    activeIndex,
    appearance,
    zoom,
    initialZoom,
  });

  const {
    handleImageLoad,
    handlePanEnd,
    handlePanMove,
    handlePanStart,
    handleStepZoom,
    imageStyle,
    isPanning,
    stageStyle,
  } = useLightboxCamera({
    activeImage,
    zoom,
    minZoom,
    maxZoom,
    baseScaleMode,
    baseScaleBias,
    shouldRender,
    isAnnotating,
    annotationTool,
    viewportRef,
    onZoomTiming: setPendingZoomTiming,
    onZoomChange: setZoom,
  })

  useLightboxKeyboard({
    shouldRender,
    isAnnotating,
    isStudioAppearance,
    hasCommitHandler: !!onCommitAnnotatedImage,
    onClose,
    onPrev,
    onNext,
    onToggleAnnotating: () => setIsAnnotating((current) => !current),
    onCloseContextMenu: closeContextMenu,
  });

  useBodyScrollLock(shouldRender);

  // Reset zoom on image change
  useEffect(() => {
    if (shouldRender) {
      setZoom(initialZoom)
    }
  }, [activeImage, initialZoom, shouldRender])

  // Reset all state on close
  useEffect(() => {
    if (!shouldRender) {
      resetExport();
      setIsAnnotating(false);
      setAnnotationTool('pen');
      setAnnotationColor(DEFAULT_COLOR);
      setAnnotationStrokeWidth(DEFAULT_WIDTH);
      setIsBrushSettingsOpen(false);
    }
  }, [shouldRender, resetExport]);

  // Focus shell on open
  useEffect(() => {
    if (!shouldRender) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      shellRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shouldRender]);

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY);
  };

  if (!shouldRender || !activeImage) {
    return null;
  }

  const shellClassName = isStudioAppearance
    ? `bg-white/30 dark:bg-bg-primary/72 ${isExiting ? 'animate-fade-out-soft' : 'animate-fade-in-soft'}`
    : 'bg-bg-primary/70 dark:bg-black/85'

  return createPortal(
    <>
      <div
        ref={shellRef}
        tabIndex={-1}
        className={`fixed inset-0 z-[180] flex flex-col overflow-hidden text-text-primary backdrop-blur-xl dark:text-white/90 ${shellClassName}`}
      >
        {isStudioAppearance ? <StudioGradientOverlay /> : null}
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="absolute inset-0 h-full w-full cursor-default"
        />
        <LightboxToolbar
          activeIndex={activeIndex}
          total={total}
          editableFilename={editableFilename}
          zoom={zoom}
          zoomDisplayScale={zoomDisplayScale}
          isStudioAppearance={isStudioAppearance}
          onPrev={onPrev}
          onNext={onNext}
          onClose={onClose}
          onStepZoom={handleStepZoom}
        />
        <div
          ref={viewportRef}
          className={`relative z-10 flex flex-1 items-center justify-center overflow-hidden ${
            isStudioAppearance ? 'p-4 sm:p-6' : 'px-6 pb-6'
          }`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          {isStudioAppearance && onCommitAnnotatedImage ? (
            <AnnotationToolbar
              isAnnotating={isAnnotating}
              tool={annotationTool}
              color={annotationColor}
              strokeWidth={annotationStrokeWidth}
              isBrushSettingsOpen={isBrushSettingsOpen}
              onToolChange={setAnnotationTool}
              onColorChange={setAnnotationColor}
              onStrokeWidthChange={setAnnotationStrokeWidth}
              onBrushSettingsToggle={() => setIsBrushSettingsOpen((current) => !current)}
            />
          ) : null}
          <LightboxStage
            activeImage={activeImage}
            activeIndex={activeIndex}
            alt={t('image.lightboxAlt', { index: activeIndex + 1 })}
            imageRef={imageRef}
            isAnnotating={isAnnotating}
            annotationTool={annotationTool}
            annotationColor={annotationColor}
            annotationStrokeWidth={annotationStrokeWidth}
            isPanning={isPanning}
            isStudioAppearance={isStudioAppearance}
            isExiting={isExiting}
            imageStyle={imageStyle}
            stageStyle={stageStyle}
            onImageLoad={(e) => handleTrackedImageLoad(e, handleImageLoad)}
            onPanStart={handlePanStart}
            onPanMove={handlePanMove}
            onPanEnd={handlePanEnd}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={handleContextMenu}
            onPreventContextMenu={(event) => event.preventDefault()}
            onCancelAnnotating={() => setIsAnnotating(false)}
            onCommitAnnotatedImage={onCommitAnnotatedImage}
            buildAnnotatedFilename={() => buildAnnotatedFilename(editableFilename)}
          />
        </div>
      </div>
      <ImageContextMenu
        state={contextMenu}
        appearance={appearance}
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
        onClose={closeContextMenu}
      />
    </>,
    document.body,
  );
}
