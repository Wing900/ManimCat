import type { OutputMode, Quality } from '../../../shared/types/api';
import { MAX_IMAGES, QUALITY_OPTIONS } from './constants';
import { useI18n } from '../../../shared/i18n/index';

interface FormToolbarProps {
  loading: boolean;
  quality: Quality;
  outputMode: OutputMode;
  imageCount: number;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onChangeQuality: (quality: Quality) => void;
  onChangeOutputMode: (mode: OutputMode) => void;
  onOpenImageMode: () => void;
  onUploadFiles: (files: FileList) => Promise<void>;
}

export function FormToolbar({
  loading,
  quality,
  outputMode,
  imageCount,
  fileInputRef,
  onChangeQuality,
  onChangeOutputMode,
  onOpenImageMode,
  onUploadFiles,
}: FormToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && onUploadFiles(e.target.files)}
          disabled={loading || imageCount >= MAX_IMAGES}
        />
        <button
          type="button"
          onClick={onOpenImageMode}
          disabled={loading || imageCount >= MAX_IMAGES}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-normal text-text-secondary hover:text-text-primary bg-bg-tertiary/30 hover:bg-bg-tertiary/40 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {imageCount > 0
            ? t('form.referenceImagesCount', { count: imageCount, max: MAX_IMAGES })
            : t('form.referenceImages')}
        </button>
      </div>

      <div className="flex items-center gap-1 bg-bg-tertiary/20 rounded-lg p-1">
        {QUALITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChangeQuality(option.value)}
            disabled={loading}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              quality === option.value
                ? 'bg-bg-tertiary/50 text-text-primary'
                : 'text-text-secondary/60 hover:text-text-secondary hover:bg-bg-tertiary/30'
            }`}
          >
            {option.value === 'low' ? '480p' : option.value === 'medium' ? '720p' : '1080p'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 bg-bg-tertiary/20 rounded-lg p-1">
        <button
          type="button"
          onClick={() => onChangeOutputMode('video')}
          disabled={loading}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
            outputMode === 'video'
              ? 'bg-bg-tertiary/50 text-text-primary'
              : 'text-text-secondary/60 hover:text-text-secondary hover:bg-bg-tertiary/30'
          }`}
        >
          {t('form.output.video')}
        </button>
        <button
          type="button"
          onClick={() => onChangeOutputMode('image')}
          disabled={loading}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
            outputMode === 'image'
              ? 'bg-bg-tertiary/50 text-text-primary'
              : 'text-text-secondary/60 hover:text-text-secondary hover:bg-bg-tertiary/30'
          }`}
        >
          {t('form.output.image')}
        </button>
      </div>
    </div>
  );
}
