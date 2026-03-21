import { useState } from 'react';
import { ImageLightbox } from './image-preview/lightbox';
import { useImageDownload } from './image-preview/use-image-download';
import { useI18n } from '../i18n';

interface ImagePreviewProps {
  imageUrls: string[];
}

export function ImagePreview({ imageUrls }: ImagePreviewProps) {
  const { t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const { isDownloadingSingle, isDownloadingAll, handleDownloadAll, handleDownloadSingle } = useImageDownload(imageUrls);
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, imageUrls.length - 1));
  const activeImage = imageUrls[safeActiveIndex];
  const hasImages = imageUrls.length > 0;

  return (
    <div className="h-full flex flex-col bg-bg-secondary/30 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <h3 className="text-xs font-medium text-text-secondary/80 uppercase tracking-wide">{t('image.title')}</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsLightboxOpen(true)}
            disabled={!hasImages}
            className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" />
            </svg>
            {t('image.openLightbox')}
          </button>
          <button
            onClick={() => void handleDownloadSingle(activeImage, safeActiveIndex)}
            disabled={!hasImages || isDownloadingSingle || isDownloadingAll}
            className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {isDownloadingSingle ? t('image.downloading') : t('common.download')}
          </button>
          <button
            onClick={() => void handleDownloadAll(imageUrls)}
            disabled={!hasImages || isDownloadingAll || isDownloadingSingle}
            className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {isDownloadingAll ? t('image.zipping') : t('image.downloadAll')}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-black/90 flex items-center justify-center">
        {activeImage ? (
          <button
            type="button"
            onClick={() => setIsLightboxOpen(true)}
            className="w-full h-full cursor-zoom-in"
            title={t('image.openTitle')}
          >
            <img src={activeImage} alt={t('image.itemAlt', { index: safeActiveIndex + 1 })} className="w-full h-full object-contain" />
          </button>
        ) : (
          <p className="text-xs text-text-secondary/60">{t('image.empty')}</p>
        )}
      </div>

      {imageUrls.length > 1 && (
        <div className="px-3 py-2 bg-bg-secondary/40">
          <div className="flex gap-2 overflow-x-auto">
            {imageUrls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`shrink-0 rounded-md overflow-hidden border transition-all ${
                  index === safeActiveIndex ? 'border-accent' : 'border-border/50 opacity-80 hover:opacity-100'
                }`}
              >
                <img
                  src={url}
                  alt={t('image.thumbAlt', { index: index + 1 })}
                  className="w-16 h-12 object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <ImageLightbox
        isOpen={isLightboxOpen}
        activeImage={activeImage}
        activeIndex={safeActiveIndex}
        total={imageUrls.length}
        zoom={zoom}
        onZoomOut={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
        onZoomIn={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))}
        onClose={() => {
          setIsLightboxOpen(false);
          setZoom(1);
        }}
      />
    </div>
  );
}
