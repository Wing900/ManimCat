// 结果展示区域

import { memo } from 'react';
import { CodeView } from '../../../shared/components/CodeView';
import { ImagePreview } from './ImagePreview';
import { VideoPreview } from './VideoPreview';
import type { OutputMode } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n/index';

interface ResultSectionProps {
  code: string;
  outputMode: OutputMode;
  videoUrl: string;
  imageUrls: string[];
  usedAI: boolean;
  renderQuality: string;
  generationType: string;
  onCodeChange?: (code: string) => void;
  onRerender?: () => void;
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
  onCodeChange,
  onRerender,
  onAiModify,
  isBusy = false
}: ResultSectionProps) {
  const { t } = useI18n();
  const hasActions = onRerender || onAiModify;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {/* 代码与视频预览 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[420px]">
          <CodeView code={code} editable={Boolean(onCodeChange)} onChange={onCodeChange} disabled={isBusy} />
        </div>
        <div className="h-[420px]">
          {outputMode === 'image' ? (
            <ImagePreview imageUrls={imageUrls} />
          ) : (
            <VideoPreview videoUrl={videoUrl} />
          )}
        </div>
      </div>

      {/* 底部信息栏 + 操作按钮 */}
      <div className="flex items-center justify-between border-t border-border/40 pt-3 px-1">
        <p className="text-xs text-text-secondary/60">
          {outputMode} · {generationType}{usedAI ? ' (AI)' : ''} · {renderQuality}
        </p>
        {hasActions && (
          <div className="flex items-center gap-2.5">
            {onRerender && (
              <button
                onClick={onRerender}
                disabled={isBusy}
                className="px-4 py-1.5 text-xs font-medium text-text-secondary/80 hover:text-text-primary bg-bg-secondary/30 hover:bg-bg-secondary/50 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('result.rerender')}
              </button>
            )}
            {onAiModify && (
              <button
                onClick={onAiModify}
                disabled={isBusy}
                className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-accent/20"
              >
                {t('result.aiModify')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
