import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReferenceImage } from '../../types/api';
import { MAX_IMAGE_SIZE, MAX_IMAGES } from './constants';

interface UseReferenceImagesResult {
  images: ReferenceImage[];
  imageError: string | null;
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addImages: (files: FileList | File[]) => Promise<void>;
  removeImage: (index: number) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_SIZE) {
      reject(new Error(`图片大小不能超过 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useReferenceImages(): UseReferenceImagesResult {
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      setImageError(null);
      const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));

      if (fileArray.length === 0) {
        setImageError('请选择有效的图片文件');
        return;
      }

      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) {
        setImageError(`最多只能添加 ${MAX_IMAGES} 张图片`);
        return;
      }

      const toAdd = fileArray.slice(0, remaining);

      try {
        const newImages: ReferenceImage[] = await Promise.all(
          toAdd.map(async (file) => ({
            url: await fileToBase64(file),
          }))
        );
        setImages((prev) => [...prev, ...newImages]);
      } catch (err) {
        setImageError(err instanceof Error ? err.message : '图片处理失败');
      }
    },
    [images.length]
  );

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
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
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

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
    removeImage,
    handleDrop,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
  };
}
