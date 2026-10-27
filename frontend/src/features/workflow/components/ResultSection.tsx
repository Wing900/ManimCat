// 结果展示区域

import { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePreview } from './ImagePreview';
import { VideoPreview } from './VideoPreview';
import { CodeModal } from './CodeModal';
import type { OutputMode, Quality } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n/index';

interface ResultSectionProps {
  code: string;
  outputMode: OutputMode;
  videoUrl: string;
  imageUrls: string[];
  usedAI: boolean;
  renderQuality: string;
  generationType: string;
  quality?: Quality;
  frameRate?: number;
  onCodeChange?: (code: string) => void;
  onRerender?: (quality?: Quality, frameRate?: number) => void;
  onAiModify?: () => void;
  isBusy?: boolean;
}

export const ResultSection = memo(function ResultSection({
  code,
  outputMode,
  videoUrl,
  imageUrls,
  usedAI,
  renderQuality,
  generationType,
  quality,
  frameRate,
  onCodeChange,
  onRerender,
  onAiModify,
  isBusy = false
}: ResultSectionProps) {
  const { t } = useI18n();
  const hasActions = Boolean(onAiModify);
  const [codeModalOpen, setCodeModalOpen] = useState(false);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      {/* 结果预览 */}
      <div className="w-full">
        {outputMode === 'image' ? (
          <div className="h-[420px]">
            <ImagePreview imageUrls={imageUrls} />
          </div>
        ) : (
          <VideoPreview videoUrl={videoUrl} />
        )}
      </div>

      {/* 底部信息栏 + 操作按钮 */}
      <div className="flex items-center justify-between border-t border-border/40 pt-3 px-1">
        <p className="text-xs text-text-secondary/60">
          {outputMode} · {generationType}{usedAI ? ' (AI)' : ''} · {renderQuality}
        </p>
        {hasActions && (
          <div className="flex items-center gap-2.5">
            {onAiModify && (
              <button
                onClick={onAiModify}
                disabled={isBusy}
                className="px-5 py-2.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-accent/20"
              >
                {t('result.aiModify')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 代码悬浮入口 */}
      {!codeModalOpen && createPortal(
        <button
          type="button"
          onClick={() => setCodeModalOpen(true)}
          aria-label={t('codeView.title')}
          title={t('codeView.title')}
          className="fixed right-5 bottom-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-bg-secondary text-text-secondary shadow-lg shadow-black/10 border border-border/10 transition-all hover:text-accent hover:bg-bg-secondary/80 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:right-6 sm:bottom-6 sm:h-[52px] sm:w-[52px]"
        >
          <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16" />
          </svg>
        </button>,
        document.body
      )}

      <CodeModal
        isOpen={codeModalOpen}
        code={code}
        defaultQuality={quality ?? 'medium'}
        defaultFrameRate={frameRate ?? 60}
        disabled={isBusy}
        onCodeChange={onCodeChange}
        onClose={() => setCodeModalOpen(false)}
        onRerender={(nextQuality, nextFrameRate) => {
          setCodeModalOpen(false);
          onRerender?.(nextQuality, nextFrameRate);
        }}
      />
    </div>
  );
});
