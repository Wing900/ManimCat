import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ReferenceImage } from '../../../shared/types/api';
import { MAX_IMAGE_SIZE } from './constants';
import { uploadReferenceImage } from '../../../infrastructure/api/api';
import { useI18n } from '../../../shared/i18n/index';
import { getWorkflowDraft, updateWorkflowDraft, useWorkflowDraft } from './workflow-draft';

interface UseReferenceImagesResult {
  images: ReferenceImage[];
  imageError: string | null;
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addImages: (files: FileList | File[]) => Promise<void>;
  appendImages: (nextImages: ReferenceImage[]) => void;
  removeImage: (index: number) => void;
  clearImages: () => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
}

interface UseReferenceImagesOptions {
  enablePasteListener?: boolean;
}

export function useReferenceImages(options: UseReferenceImagesOptions = {}): UseReferenceImagesResult {
  const { enablePasteListener = true } = options;
  const { t } = useI18n();
  const { referenceImages: images } = useWorkflowDraft();
  const setImages = useCallback((change: SetStateAction<ReferenceImage[]>) => {
    const previous = getWorkflowDraft().referenceImages;
    updateWorkflowDraft({ referenceImages: typeof change === 'function' ? change(previous) : change });
  }, []);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      setImageError(null);
      const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));

      if (fileArray.length === 0) {
        setImageError(t('reference.invalidFile'));
        return;
      }

      try {
        for (const file of fileArray) {
          if (file.size > MAX_IMAGE_SIZE) {
            throw new Error(t('reference.maxSize', { size: MAX_IMAGE_SIZE / 1024 / 1024 }));
          }
        }

        const uploads = await Promise.allSettled(
          fileArray.map(async (file) => {
            const uploaded = await uploadReferenceImage(file);
            return {
              url: uploaded.url,
              detail: 'low' as const,
            };
          })
        );
        const newImages = uploads.flatMap((upload) => upload.status === 'fulfilled' ? [upload.value] : []);
        setImages((prev) => [...prev, ...newImages]);
        const failed = uploads.find((upload) => upload.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      } catch (err) {
        setImageError(err instanceof Error ? err.message : t('reference.processFailed'));
      }
    },
    [t, setImages]
  );

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImageError(null);
  }, [setImages]);

  const appendImages = useCallback((nextImages: ReferenceImage[]) => {
    if (nextImages.length === 0) {
      return;
    }
    setImages((prev) => [...prev, ...nextImages]);
    setImageError(null);
  }, [setImages]);

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        await addImages(imageFiles);
      }
    },
    [addImages]
  );

  useEffect(() => {
    if (!enablePasteListener) {
      return undefined;
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [enablePasteListener, handlePaste]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        await addImages(e.dataTransfer.files);
      }
    },
    [addImages]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  return {
    images,
    imageError,
    isDragging,
    fileInputRef,
    addImages,
    appendImages,
    removeImage,
    clearImages: () => {
      setImages([]);
      setImageError(null);
    },
    handleDrop,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
  };
}
