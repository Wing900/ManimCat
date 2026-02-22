// 输入表单组件 - MD3 风格

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OutputMode, Quality, ReferenceImage } from '../types/api';
import { loadSettings } from '../lib/settings';
import { FormToolbar } from './input-form/form-toolbar';
import { ReferenceImageList } from './input-form/reference-image-list';
import { useReferenceImages } from './input-form/use-reference-images';

interface InputFormProps {
  onSubmit: (data: {
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  }) => void;
  loading: boolean;
}

export function InputForm({ onSubmit, loading }: InputFormProps) {
  const [concept, setConcept] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>(loadSettings().video.quality);
  const [outputMode, setOutputMode] = useState<OutputMode>('video');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
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
  } = useReferenceImages();

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
      referenceImages: images.length > 0 ? images : undefined,
    });
  }, [concept, quality, outputMode, images, onSubmit]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && !loading) {
        e.preventDefault();
        handleSubmit();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loading, handleSubmit]);

  useEffect(() => {
    if (concept.length > 0 && concept.length < 5) {
      setError('请至少输入 5 个字符');
    } else {
      setError(null);
    }
  }, [concept]);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleFormSubmit} className="space-y-6">
        <div
          className={`relative transition-all duration-200 ${isDragging ? 'scale-[1.02]' : ''}`}
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

        <FormToolbar
          loading={loading}
          quality={quality}
          outputMode={outputMode}
          imageCount={images.length}
          fileInputRef={fileInputRef}
          onChangeQuality={setQuality}
          onChangeOutputMode={setOutputMode}
          onUploadFiles={addImages}
        />

        <ReferenceImageList images={images} loading={loading} onRemove={removeImage} />

        {imageError && <p className="text-xs text-red-500">{imageError}</p>}

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
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
          </button>
        </div>

        <p className="text-center text-xs text-text-secondary/50">
          按 <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Enter</kbd> 快速提交
        </p>
      </form>
    </div>
  );
}
