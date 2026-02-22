// 输入表单组件 - MD3 风格

import { useState, useRef, useEffect, useCallback } from 'react';
import type { OutputMode, Quality, ReferenceImage } from '../types/api';
import { loadSettings } from '../lib/settings';

interface InputFormProps {
  onSubmit: (data: { concept: string; quality: Quality; outputMode: OutputMode; referenceImages?: ReferenceImage[] }) => void;
  loading: boolean;
}

const MAX_IMAGES = 3;
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB

/** 质量选项 */
const QUALITY_OPTIONS = [
  { value: 'low' as Quality, label: '低 (480p)', desc: '最快' },
  { value: 'medium' as Quality, label: '中 (720p)', desc: '' },
  { value: 'high' as Quality, label: '高 (1080p)', desc: '最慢' },
];

export function InputForm({ onSubmit, loading }: InputFormProps) {
  const [concept, setConcept] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>(loadSettings().video.quality);
  const [outputMode, setOutputMode] = useState<OutputMode>('video');
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 文件转 base64
  const fileToBase64 = (file: File): Promise<string> => {
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
  };

  // 添加图片
  const addImages = async (files: FileList | File[]) => {
    setImageError(null);
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));

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
          url: await fileToBase64(file)
        }))
      );
      setImages(prev => [...prev, ...newImages]);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '图片处理失败');
    }
  };

  // 删除图片
  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setImageError(null);
  };

  // 处理粘贴
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
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
  }, [images.length]);

  // 监听粘贴事件
  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // 处理拖拽
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await addImages(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有离开整个区域时才取消高亮
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  // 键盘快捷键：Ctrl+Enter 提交
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && !loading) {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loading, concept, quality, outputMode]);

  // 实时验证
  useEffect(() => {
    if (concept.length > 0 && concept.length < 5) {
      setError('请至少输入 5 个字符');
    } else {
      setError(null);
    }
  }, [concept]);

  const handleSubmit = useCallback(() => {
    if (concept.trim().length < 5) {
      setError('请至少输入 5 个字符描述你想要动画的内容');
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit({
      concept: concept.trim(),
      quality,
      outputMode,
      referenceImages: images.length > 0 ? images : undefined
    });
  }, [concept, quality, outputMode, images, onSubmit]);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleFormSubmit} className="space-y-6">
        {/* 概念输入 - MD3 Filled Text Field */}
        <div
          className={`relative transition-all duration-200 ${
            isDragging ? 'scale-[1.02]' : ''
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
        >
          <label
            htmlFor="concept"
            className={`absolute left-4 -top-2.5 px-2 bg-bg-primary text-xs font-medium transition-all z-10 ${
              isDragging ? 'text-accent' : error ? 'text-red-500' : 'text-text-secondary'
            }`}
          >
            {isDragging ? '松开以添加图片' : error ? error : '描述你想要的动画'}
          </label>
          <textarea
            ref={textareaRef}
            id="concept"
            name="concept"
            rows={4}
            placeholder="例如：展示单位圆上正弦和余弦的关系...（支持拖入或粘贴参考图片）"
            disabled={loading}
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            className={`w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 transition-all resize-none ${
              isDragging
                ? 'ring-2 ring-accent/50 bg-accent/5 border-2 border-dashed border-accent/30'
                : error
                  ? 'focus:ring-red-500/20 bg-red-50/50 dark:bg-red-900/10'
                  : 'focus:ring-accent/20 focus:bg-bg-secondary/70'
            }`}
          />
        </div>

        {/* 工具栏 - 一行布局 */}
        <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
          {/* 左侧：参考图按钮 */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addImages(e.target.files)}
              disabled={loading || images.length >= MAX_IMAGES}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || images.length >= MAX_IMAGES}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary bg-bg-secondary/50 hover:bg-bg-secondary/70 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {images.length > 0 ? `参考图 ${images.length}/${MAX_IMAGES}` : '参考图'}
            </button>
          </div>

          {/* 中间：质量标签组 */}
          <div className="flex items-center gap-1 bg-bg-secondary/30 rounded-lg p-1">
            {QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setQuality(option.value)}
                disabled={loading}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  quality === option.value
                    ? 'bg-bg-secondary text-text-primary'
                    : 'text-text-secondary/60 hover:text-text-secondary hover:bg-bg-secondary/50'
                }`}
              >
                {option.value === 'low' ? '480p' : option.value === 'medium' ? '720p' : '1080p'}
              </button>
            ))}
          </div>

          {/* 右侧：输出模式 */}
          <div className="flex items-center gap-1 bg-bg-secondary/30 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setOutputMode('video')}
              disabled={loading}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                outputMode === 'video'
                  ? 'bg-bg-secondary text-text-primary'
                  : 'text-text-secondary/60 hover:text-text-secondary hover:bg-bg-secondary/50'
              }`}
            >
              视频
            </button>
            <button
              type="button"
              onClick={() => setOutputMode('image')}
              disabled={loading}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                outputMode === 'image'
                  ? 'bg-bg-secondary text-text-primary'
                  : 'text-text-secondary/60 hover:text-text-secondary hover:bg-bg-secondary/50'
              }`}
            >
              图片
            </button>
          </div>
        </div>

        {/* 图片预览 */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={img.url}
                  alt={`参考图片 ${idx + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border border-border/50"
                />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  disabled={loading}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 错误提示 */}
        {imageError && (
          <p className="text-xs text-red-500">{imageError}</p>
        )}

        {/* 提交按钮 */}
        <div className="flex justify-center pt-4">
          <button
            type="submit"
            disabled={loading || concept.trim().length < 5}
            className="group relative px-12 py-3.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-full shadow-lg shadow-accent/25 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl hover:shadow-accent/35 active:scale-[0.97] overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2">
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  生成中...
                </>
              ) : (
                <>
                  {outputMode === 'image' ? '生成图片' : '生成动画'}
                  <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </span>
            {/* 按钮光效 */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
          </button>
        </div>

        {/* 快捷键提示 */}
        <p className="text-center text-xs text-text-secondary/50">
          按 <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Enter</kbd> 快速提交
        </p>
      </form>
    </div>
  );
}
