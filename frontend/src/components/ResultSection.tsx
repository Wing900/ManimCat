// 结果展示组件

import { CodeView } from './CodeView';
import { VideoPreview } from './VideoPreview';

interface ResultSectionProps {
  code: string;
  videoUrl: string;
  usedAI: boolean;
  renderQuality: string;
  generationType: string;
}

export function ResultSection({ code, videoUrl, usedAI, renderQuality, generationType }: ResultSectionProps) {
  return (
    <div className="w-full max-w-4xl mx-auto space-y-5">
      {/* 代码和视频预览 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[360px]">
          <CodeView code={code} />
        </div>
        <div className="h-[360px]">
          <VideoPreview videoUrl={videoUrl} />
        </div>
      </div>

      {/* 生成信息 */}
      <div className="bg-bg-secondary/30 rounded-xl px-4 py-2.5">
        <p className="text-xs text-text-secondary/70">
          {generationType}{usedAI ? ' (AI)' : ''} · {renderQuality}
        </p>
      </div>
    </div>
  );
}
