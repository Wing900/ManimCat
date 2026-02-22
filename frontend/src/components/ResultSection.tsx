// 结果展示区域

import { CodeView } from './CodeView';
import { ImagePreview } from './ImagePreview';
import { VideoPreview } from './VideoPreview';
import type { OutputMode } from '../types/api';

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

export function ResultSection({
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
  const hasActions = onRerender || onAiModify;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5">
      {/* 代码与视频预览 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[360px]">
          <CodeView code={code} editable={Boolean(onCodeChange)} onChange={onCodeChange} disabled={isBusy} />
        </div>
        <div className="h-[360px]">
          {outputMode === 'image' ? (
            <ImagePreview imageUrls={imageUrls} />
          ) : (
            <VideoPreview videoUrl={videoUrl} />
          )}
        </div>
      </div>

      {/* 结果信息 */}
      <div className="bg-bg-secondary/30 rounded-xl px-4 py-2.5">
        <p className="text-xs text-text-secondary/70">
          {outputMode} · {generationType}{usedAI ? ' (AI)' : ''} · {renderQuality}
        </p>
      </div>

      {hasActions && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {onRerender && (
            <button
              onClick={onRerender}
              disabled={isBusy}
              className="px-5 py-2 text-xs font-medium text-text-secondary/80 hover:text-text-primary bg-bg-secondary/30 hover:bg-bg-secondary/50 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              重新渲染
            </button>
          )}
          {onAiModify && (
            <button
              onClick={onAiModify}
              disabled={isBusy}
              className="px-5 py-2 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-accent/20"
            >
              AI修改
            </button>
          )}
        </div>
      )}
    </div>
  );
}
