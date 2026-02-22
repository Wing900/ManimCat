import { InputForm } from '../InputForm';
import { LoadingSpinner } from '../LoadingSpinner';
import { ResultSection } from '../ResultSection';
import type { JobResult, OutputMode, ProcessingStage, Quality, ReferenceImage } from '../../types/api';

interface LastRequest {
  concept: string;
  quality: Quality;
  outputMode: OutputMode;
  referenceImages?: ReferenceImage[];
}

interface StatusContentProps {
  status: 'idle' | 'processing' | 'completed' | 'error';
  result: JobResult | null;
  error: string | null;
  jobId: string | null;
  stage: ProcessingStage;
  currentCode: string;
  isBusy: boolean;
  lastRequest: LastRequest | null;
  onSubmit: (data: LastRequest) => void;
  onCodeChange: (code: string) => void;
  onRerender: () => void;
  onAiModifyOpen: () => void;
  onResetAll: () => void;
  onCancel: () => void;
}

export function StatusContent({
  status,
  result,
  error,
  jobId,
  stage,
  currentCode,
  isBusy,
  lastRequest,
  onSubmit,
  onCodeChange,
  onRerender,
  onAiModifyOpen,
  onResetAll,
  onCancel,
}: StatusContentProps) {
  if (status === 'idle') {
    return <InputForm onSubmit={onSubmit} loading={false} />;
  }

  if (status === 'processing') {
    return (
      <div className="bg-bg-secondary/20 rounded-2xl p-8">
        <LoadingSpinner stage={stage} jobId={jobId || undefined} onCancel={onCancel} />
      </div>
    );
  }

  if (status === 'completed' && result) {
    return (
      <div
        className="space-y-6 animate-fade-in"
        style={{
          animation: 'fadeInUp 0.5s ease-out forwards',
        }}
      >
        <ResultSection
          code={currentCode || result.code || ''}
          outputMode={result.output_mode || lastRequest?.outputMode || 'video'}
          videoUrl={result.video_url || ''}
          imageUrls={result.image_urls || []}
          usedAI={result.used_ai || false}
          renderQuality={result.render_quality || ''}
          generationType={result.generation_type || ''}
          onCodeChange={onCodeChange}
          onRerender={onRerender}
          onAiModify={onAiModifyOpen}
          isBusy={isBusy}
        />

        <div className="text-center">
          <button
            onClick={onResetAll}
            className="px-8 py-2.5 text-sm text-text-secondary/80 hover:text-accent transition-colors bg-bg-secondary/30 hover:bg-bg-secondary/50 rounded-full"
          >
            生成新的内容
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="bg-red-50/80 dark:bg-red-900/20 rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <div className="text-red-500 mt-0.5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-text-primary font-medium mb-1">出错了</p>
            <p className="text-text-secondary text-sm">{error || '生成失败，请重试'}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={onResetAll}
            className="px-4 py-2 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return null;
}
