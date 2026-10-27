// 结果展示区域

import { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePreview } from './ImagePreview';
import { VideoPreview } from './VideoPreview';
import { CodeModal } from './CodeModal';
import { ResultActions } from './ResultActions';
import type { OutputMode, Quality } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n/index';

interface ResultSectionProps {
  code: string;
  outputMode: OutputMode;
  videoUrl: string;
  imageUrls: string[];
  renderQuality: string;
  quality?: Quality;
  frameRate?: number;
  onCodeChange?: (code: string) => void;
  onRerender?: (quality?: Quality, frameRate?: number) => void;
  onAiModify?: () => void;
  onNewContent?: () => void;
  isBusy?: boolean;
}

export const ResultSection = memo(function ResultSection({
  code,
  outputMode,
  videoUrl,
  imageUrls,
  renderQuality,
  quality,
  frameRate,
  onCodeChange,
  onRerender,
  onAiModify,
  onNewContent,
  isBusy = false
}: ResultSectionProps) {
  const { t } = useI18n();
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const effectiveQuality: Quality = (
    renderQuality === 'low' || renderQuality === 'medium' || renderQuality === 'high'
      ? renderQuality
      : (quality ?? 'medium')
  );

  return (
    <div className="w-full max-w-3xl mx-auto">
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

      {/* 主操作区 */}
      <ResultActions
        videoUrl={videoUrl}
        quality={effectiveQuality}
        frameRate={frameRate}
        outputMode={outputMode}
        isBusy={isBusy}
        onAiModify={onAiModify}
        onNewContent={onNewContent}
        onRerender={onRerender}
      />

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
        defaultQuality={effectiveQuality}
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
