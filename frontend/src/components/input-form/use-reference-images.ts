import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReferenceImage } from '../../types/api';
import { MAX_IMAGE_SIZE, MAX_IMAGES } from './constants';
import { uploadReferenceImage } from '../../lib/api';
import { useI18n } from '../../i18n';

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
  const [images, setImages] = useState<ReferenceImage[]>([]);
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

      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) {
        setImageError(t('reference.limit', { count: MAX_IMAGES }));
        return;
      }

      const toAdd = fileArray.slice(0, remaining);

      try {
        for (const file of toAdd) {
          if (file.size > MAX_IMAGE_SIZE) {
            throw new Error(t('reference.maxSize', { size: MAX_IMAGE_SIZE / 1024 / 1024 }));
          }
        }

        const newImages: ReferenceImage[] = await Promise.all(
          toAdd.map(async (file) => {
            const uploaded = await uploadReferenceImage(file);
            return {
              url: uploaded.url,
              detail: 'low',
            };
          })
        );
        setImages((prev) => [...prev, ...newImages]);
      } catch (err) {
        setImageError(err instanceof Error ? err.message : t('reference.processFailed'));
      }
    },
    [images.length, t]
  );

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImageError(null);
  }, []);

  const appendImages = useCallback((nextImages: ReferenceImage[]) => {
    if (nextImages.length === 0) {
      return;
    }
    setImages((prev) => [...prev, ...nextImages].slice(0, MAX_IMAGES));
    setImageError(null);
  }, []);

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
