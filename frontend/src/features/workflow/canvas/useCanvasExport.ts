import { useRef, useState } from 'react';
import { uploadReferenceImage } from '../../../infrastructure/api/api';
import type { ReferenceImage } from '../../../shared/types/api';
import { dataUrlToFile, renderPageToDataUrl } from './canvas-export';
import type { CanvasPage, PreviewImage } from './types';

export function useCanvasExport() {
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(false);
  // Lock double clicks synchronously, before React commits the busy state.
  const busy = useRef(false);
  const prepare = (pages: CanvasPage[]) => {
    setError(false);
    try { setPreviewImages(pages.map((page) => ({ id: page.id, dataUrl: renderPageToDataUrl(page) }))); setIsPreviewOpen(true); }
    catch { setError(true); }
  };
  const confirm = async (onComplete: (images: ReferenceImage[]) => void, onClose: () => void) => {
    if (busy.current || !previewImages.length) return;
    busy.current = true; setIsExporting(true); setError(false);
    try {
      const images: ReferenceImage[] = [];
      for (const [index, image] of previewImages.entries()) {
        const uploaded = await uploadReferenceImage(dataUrlToFile(image.dataUrl, `canvas-page-${String(index + 1).padStart(2, '0')}.png`));
        images.push({ url: uploaded.url, detail: 'low' });
      }
      onComplete(images); setIsPreviewOpen(false); onClose();
    } catch { setError(true); }
    finally { busy.current = false; setIsExporting(false); }
  };
  return { previewImages, isPreviewOpen, isExporting, error, prepare, confirm, close: () => { if (!busy.current) setIsPreviewOpen(false); } };
}

