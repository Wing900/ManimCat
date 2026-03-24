import { useEffect } from 'react';
import { useI18n } from '../../i18n';

interface ImageLightboxProps {
  isOpen: boolean;
  activeImage?: string;
  activeIndex: number;
  total: number;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
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
  onZoomOut,
  onZoomIn,
  onPrev,
  onNext,
  onClose,
}: ImageLightboxProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
        onPrev?.();
      } else if (event.key === 'ArrowRight') {
        onNext?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onNext, onPrev]);

  if (!isOpen || !activeImage) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 text-white/90">
        <div className="text-xs">
          {t('image.lightboxTitle', { current: activeIndex + 1, total })}
        </div>
        <div className="flex items-center gap-3">
          {onPrev ? (
            <button type="button" onClick={onPrev} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs">
              ←
            </button>
          ) : null}
          {onNext ? (
            <button type="button" onClick={onNext} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs">
              →
            </button>
          ) : null}
          <button type="button" onClick={onZoomOut} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs">
            -
          </button>
          <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={onZoomIn} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs">
            +
          </button>
          <button type="button" onClick={onClose} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs">
            {t('common.close')}
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-auto px-6 pb-6">
        <img
          src={activeImage}
          alt={t('image.lightboxAlt', { index: activeIndex + 1 })}
          className="max-w-none"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
        />
      </div>
    </div>
  );
}
