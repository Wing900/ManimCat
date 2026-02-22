import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';

interface ImagePreviewProps {
  imageUrls: string[];
}

export function ImagePreview({ imageUrls }: ImagePreviewProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isDownloadingSingle, setIsDownloadingSingle] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  useEffect(() => {
    setActiveIndex(0);
  }, [imageUrls.join('|')]);

  useEffect(() => {
    if (!isLightboxOpen) {
      setZoom(1);
    }
  }, [isLightboxOpen]);

  const activeImage = imageUrls[activeIndex];
  const hasImages = imageUrls.length > 0;

  const timestampPrefix = useMemo(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }, [imageUrls.join('|')]);

  const getAbsoluteUrl = (url: string): string => {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    return new URL(url, window.location.origin).toString();
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  const handleDownloadSingle = async () => {
    if (!activeImage || isDownloadingSingle) {
      return;
    }
    setIsDownloadingSingle(true);
    try {
      const response = await fetch(getAbsoluteUrl(activeImage));
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      const blob = await response.blob();
      downloadBlob(blob, `${timestampPrefix}-image-${activeIndex + 1}.png`);
    } catch (error) {
      console.error('单张下载失败', error);
    } finally {
      setIsDownloadingSingle(false);
    }
  };

  const handleDownloadAll = async () => {
    if (!hasImages || isDownloadingAll) {
      return;
    }
    setIsDownloadingAll(true);
    try {
      const zip = new JSZip();
      await Promise.all(
        imageUrls.map(async (url, index) => {
          const response = await fetch(getAbsoluteUrl(url));
          if (!response.ok) {
            throw new Error(`图片 ${index + 1} 下载失败: ${response.status}`);
          }
          const blob = await response.blob();
          zip.file(`${timestampPrefix}-image-${index + 1}.png`, blob);
        })
      );
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `${timestampPrefix}-images.zip`);
    } catch (error) {
      console.error('打包下载失败', error);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary/30 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <h3 className="text-xs font-medium text-text-secondary/80 uppercase tracking-wide">图片预览</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsLightboxOpen(true)}
            disabled={!hasImages}
            className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" />
            </svg>
            放大预览
          </button>
          <button
            onClick={handleDownloadSingle}
            disabled={!hasImages || isDownloadingSingle || isDownloadingAll}
            className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {isDownloadingSingle ? '下载中...' : '下载'}
          </button>
          <button
            onClick={handleDownloadAll}
            disabled={!hasImages || isDownloadingAll || isDownloadingSingle}
            className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {isDownloadingAll ? '打包中...' : '下载全部'}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-black/90 flex items-center justify-center">
        {activeImage ? (
          <button
            type="button"
            onClick={() => setIsLightboxOpen(true)}
            className="w-full h-full cursor-zoom-in"
            title="点击放大预览"
          >
            <img src={activeImage} alt={`图片 ${activeIndex + 1}`} className="w-full h-full object-contain" />
          </button>
        ) : (
          <p className="text-xs text-text-secondary/60">暂无图片输出</p>
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
                  index === activeIndex ? 'border-accent' : 'border-border/50 opacity-80 hover:opacity-100'
                }`}
              >
                <img
                  src={url}
                  alt={`缩略图 ${index + 1}`}
                  className="w-16 h-12 object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {isLightboxOpen && activeImage && (
        <div className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 text-white/90">
            <div className="text-xs">
              放大预览 · 图片 {activeIndex + 1}/{imageUrls.length}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs"
              >
                -
              </button>
              <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))}
                className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setIsLightboxOpen(false)}
                className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-xs"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-auto px-6 pb-6">
            <img
              src={activeImage}
              alt={`放大图片 ${activeIndex + 1}`}
              className="max-w-none"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
