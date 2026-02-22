import { useMemo, useState } from 'react';
import JSZip from 'jszip';

interface UseImageDownloadResult {
  isDownloadingSingle: boolean;
  isDownloadingAll: boolean;
  handleDownloadSingle: (activeImage: string | undefined, activeIndex: number) => Promise<void>;
  handleDownloadAll: (imageUrls: string[]) => Promise<void>;
}

function getAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return new URL(url, window.location.origin).toString();
}

function downloadBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export function useImageDownload(imageUrls: string[]): UseImageDownloadResult {
  const [isDownloadingSingle, setIsDownloadingSingle] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const timestampPrefix = useMemo(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }, [imageUrls.join('|')]);

  const handleDownloadSingle = async (activeImage: string | undefined, activeIndex: number) => {
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

  const handleDownloadAll = async (urls: string[]) => {
    if (urls.length === 0 || isDownloadingAll) {
      return;
    }
    setIsDownloadingAll(true);
    try {
      const zip = new JSZip();
      await Promise.all(
        urls.map(async (url, index) => {
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

  return {
    isDownloadingSingle,
    isDownloadingAll,
    handleDownloadSingle,
    handleDownloadAll,
  };
}
