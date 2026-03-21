// 输入表单组件 - MD3 风格

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OutputMode, Quality, ReferenceImage } from '../types/api';
import { loadSettings } from '../lib/settings';
import { FormToolbar } from './input-form/form-toolbar';
import { ReferenceImageList } from './input-form/reference-image-list';
import { useReferenceImages } from './input-form/use-reference-images';
import { useI18n } from '../i18n';

interface InputFormProps {
  concept: string;
  onConceptChange: (value: string) => void;
  onSecretStudioOpen?: () => void;
  onSubmit: (data: {
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  }) => void;
  loading: boolean;
}

const STUDIO_KEYWORD = 'hellocats';
const TRIGGER_DELAY_MS = 1200;

export function InputForm({ concept, onConceptChange, onSecretStudioOpen, onSubmit, loading }: InputFormProps) {
  const { t } = useI18n();
  const [localError, setLocalError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>(loadSettings().video.quality);
  const [outputMode, setOutputMode] = useState<OutputMode>('video');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const studioKeywordTriggeredRef = useRef(false);
  const triggerTimerRef = useRef<number | null>(null);

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

  const derivedError = useMemo(() => {
    const trimmed = concept.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length < 5) {
      return t('form.error.minLengthShort');
    }
    return null;
  }, [concept, t]);

  const handleSubmit = useCallback(() => {
    if (concept.trim().length < 5) {
      setLocalError(t('form.error.minLength'));
      textareaRef.current?.focus();
      return;
    }

    setLocalError(null);
    onSubmit({
      concept: concept.trim(),
      quality,
      outputMode,
      referenceImages: images.length > 0 ? images : undefined,
    });
  }, [concept, quality, outputMode, images, onSubmit, t]);

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && event.shiftKey && !loading) {
      event.preventDefault();
      handleSubmit();
    }
  };

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (triggerTimerRef.current) clearTimeout(triggerTimerRef.current);
    };
  }, []);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit();
  };

  const handleConceptChange = (value: string) => {
    onConceptChange(value);

    const normalizedConcept = value.trim().toLowerCase();
    if (normalizedConcept === STUDIO_KEYWORD && !loading) {
      if (!studioKeywordTriggeredRef.current) {
        studioKeywordTriggeredRef.current = true;
        setIsRecognizing(true);
        triggerTimerRef.current = window.setTimeout(() => {
          onSecretStudioOpen?.();
          setIsRecognizing(false);
        }, TRIGGER_DELAY_MS);
      }
      return;
    }

    if (studioKeywordTriggeredRef.current && normalizedConcept !== STUDIO_KEYWORD) {
      studioKeywordTriggeredRef.current = false;
      setIsRecognizing(false);
      if (triggerTimerRef.current) {
        clearTimeout(triggerTimerRef.current);
        triggerTimerRef.current = null;
      }
    }

    setLocalError(null);
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
              isDragging || isRecognizing ? 'text-accent' : (localError || derivedError) ? 'text-red-500' : 'text-text-secondary'
            }`}
          >
            {isDragging ? t('form.label.dragging') : isRecognizing ? '暗号确认中...' : localError || derivedError || t('form.label.default')}
          </label>
          <textarea
            ref={textareaRef}
            id="concept"
            name="concept"
            rows={4}
            placeholder={t('form.placeholder')}
            disabled={loading || isRecognizing}
            value={concept}
            onChange={(e) => handleConceptChange(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            className={`w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 transition-all resize-none ${
              isDragging
                ? 'ring-2 ring-accent/50 bg-accent/5 border-2 border-dashed border-accent/30'
                : isRecognizing
                  ? 'ring-2 ring-accent/40 bg-accent/[0.03] animate-pulse'
                  : (localError || derivedError)
                    ? 'focus:ring-red-500/20 bg-red-50/50 dark:bg-red-900/10'
                    : 'focus:ring-accent/20 focus:bg-bg-secondary/70'
            }`}
          />
        </div>

        <FormToolbar
          loading={loading || isRecognizing}
          quality={quality}
          outputMode={outputMode}
          imageCount={images.length}
          fileInputRef={fileInputRef}
          onChangeQuality={setQuality}
          onChangeOutputMode={setOutputMode}
          onUploadFiles={addImages}
        />

        <ReferenceImageList images={images} loading={loading || isRecognizing} onRemove={removeImage} />

        {imageError && <p className="text-xs text-red-500">{imageError}</p>}

        <div className="flex justify-center pt-4">
          <button
            type="submit"
            disabled={loading || isRecognizing || concept.trim().length < 5}
            className="px-12 py-3.5 bg-accent/85 text-white font-medium rounded-full shadow-sm shadow-accent/5 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 active:bg-accent-hover/90"
          >
            <span className="flex items-center gap-2">
              {loading || isRecognizing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {isRecognizing ? '正在启动...' : t('form.submitting')}
                </>
              ) : (
                t('form.submit.plan')
              )}
            </span>
          </button>
        </div>

        <p className="text-center text-xs text-text-secondary/50">
          {t('form.shortcutPrefix')} <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Shift</kbd> + <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Enter</kbd> {t('form.shortcutSuffix')}
        </p>
      </form>
    </div>
  );
}
