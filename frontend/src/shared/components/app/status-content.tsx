import type { StudioKind } from '../../../features/studio/protocol/studio-agent-types';
import { InputForm } from '../../../features/workflow/components/InputForm';
import { LoadingSpinner } from '../LoadingSpinner';
import { ResultSection } from '../../../features/workflow/components/ResultSection';
import type { JobResult, JobStageHistoryEntry, OutputMode, ProcessingStage, Quality, ReferenceImage, VideoConfig } from '../../types/api';
import { useI18n } from '../../i18n/index';

interface LastRequest {
  concept: string;
  quality: Quality;
  outputMode: OutputMode;
  referenceImages?: ReferenceImage[];
  videoConfig?: VideoConfig;
}

interface StatusContentProps {
  status: 'idle' | 'processing' | 'cancelling' | 'completed' | 'error';
  result: JobResult | null;
  error: string | null;
  jobId: string | null;
  stage: ProcessingStage;
  stageHistory: JobStageHistoryEntry[];
  submittedAt: string | null;
  concept: string;
  onConceptChange: (value: string) => void;
  onSecretStudioOpen?: (studioKind: StudioKind) => void;
  currentCode: string;
  isBusy: boolean;
  lastRequest: LastRequest | null;
  onSubmit: (data: LastRequest) => void;
  onCodeChange: (code: string) => void;
  onRerender: (quality?: Quality, frameRate?: number) => void;
  onAiModifyOpen: () => void;
  onResetAll: () => void;
  onBackToHome: () => void;
  onCancel: () => void;
  onOpenGame: () => void;
}

function shouldShowProviderConfigHint(message: string | null): boolean {
  if (!message) {
    return false;
  }

  return (
    message.includes('自定义 API 配置不完整') ||
    message.includes('incomplete provider configuration') ||
    message.includes('未配置上游 AI') ||
    message.includes('model 为空') ||
    message.includes('no upstream AI is configured') ||
    message.includes('no model is available')
  );
}

export function StatusContent({
  status,
  result,
  error,
  jobId,
  stage,
  stageHistory,
  submittedAt,
  concept,
  onConceptChange,
  onSecretStudioOpen,
  currentCode,
  isBusy,
  lastRequest,
  onSubmit,
  onCodeChange,
  onRerender,
  onAiModifyOpen,
  onResetAll,
  onBackToHome,
  onCancel,
  onOpenGame,
}: StatusContentProps) {
  const { t } = useI18n();
  const canRecoverFromError = status === 'error' && Boolean(result);

  if (status === 'idle') {
    return (
      <InputForm
        concept={concept}
        onConceptChange={onConceptChange}
        onSecretStudioOpen={onSecretStudioOpen}
        onSubmit={onSubmit}
        loading={false}
      />
    );
  }

  if (status === 'processing' || status === 'cancelling') {
    return (
      <div className="animate-fade-in-soft bg-bg-secondary/20 rounded-2xl p-8">
        <LoadingSpinner
          stage={stage}
          stageHistory={stageHistory}
          jobId={jobId || undefined}
          submittedAt={submittedAt || undefined}
          onCancel={onCancel}
          onOpenGame={onOpenGame}
        />
      </div>
    );
  }

  if (status === 'completed' && result) {
    return (
      <ResultContent
        result={result}
        currentCode={currentCode}
        lastRequest={lastRequest}
        isBusy={isBusy}
        onCodeChange={onCodeChange}
        onRerender={onRerender}
        onAiModifyOpen={onAiModifyOpen}
        onResetAll={onResetAll}
      />
    );
  }

  if (status === 'error') {
    if (canRecoverFromError && result) {
      const showProviderConfigHint = shouldShowProviderConfigHint(error);
      const shownError = showProviderConfigHint
        ? t('result.error.noBackendModelConfigured')
        : (error || t('result.errorFallback'));

      return (
        <div className="max-w-3xl mx-auto space-y-6 animate-fade-in" style={{ animation: 'fadeInUp 0.4s ease-out forwards' }}>
          <div className="relative overflow-hidden rounded-[1.75rem] border border-red-200/70 bg-red-50/85 px-6 py-5 shadow-[0_20px_80px_rgba(220,38,38,0.08)]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-red-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900/90">{t('result.errorTitle')}</p>
                <p className="mt-1 text-sm leading-6 text-red-900/70">{shownError}</p>
              </div>
            </div>
          </div>

          <ResultContent
            result={result}
            currentCode={currentCode}
            lastRequest={lastRequest}
            isBusy={isBusy}
            onCodeChange={onCodeChange}
            onRerender={onRerender}
            onAiModifyOpen={onAiModifyOpen}
            onResetAll={onResetAll}
          />
        </div>
      );
    }

    const showProviderConfigHint = shouldShowProviderConfigHint(error);
    const shownError = showProviderConfigHint
      ? t('result.error.noBackendModelConfigured')
      : (error || t('result.errorFallback'));

    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in" style={{ animation: 'fadeInUp 0.4s ease-out forwards' }}>
        <div className="relative bg-red-50/80 dark:bg-red-900/20 rounded-2xl p-6 border border-red-200/60 dark:border-red-500/25">
          <div className="flex items-start gap-3">
            <div className="text-red-500 mt-0.5">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-text-primary font-medium mb-1">{t('result.errorTitle')}</p>
              <p className="text-text-secondary text-sm">{shownError}</p>
            </div>
          </div>
        </div>

        <div className="text-center space-y-2">
          <p className="text-sm text-text-secondary/75">{t('result.errorStandaloneHint')}</p>
          <button
            type="button"
            onClick={onBackToHome}
            className="px-8 py-2.5 text-sm text-text-secondary/85 hover:text-accent transition-colors bg-bg-secondary/30 hover:bg-bg-secondary/50 rounded-full"
          >
            {t('result.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

interface ResultContentProps {
  result: JobResult;
  currentCode: string;
  lastRequest: LastRequest | null;
  isBusy: boolean;
  onCodeChange: (code: string) => void;
  onRerender: (quality?: Quality, frameRate?: number) => void;
  onAiModifyOpen: () => void;
  onResetAll: () => void;
}

function ResultContent({
  result,
  currentCode,
  lastRequest,
  isBusy,
  onCodeChange,
  onRerender,
  onAiModifyOpen,
  onResetAll,
}: ResultContentProps) {
  return (
    <div
      className="w-full max-w-3xl mx-auto min-w-0 space-y-4 animate-fade-in"
      style={{
        animation: 'fadeInUp 0.5s ease-out forwards',
      }}
    >
      <ResultSection
        code={currentCode || result.code || ''}
        outputMode={result.output_mode || lastRequest?.outputMode || 'video'}
        videoUrl={result.video_url || ''}
        imageUrls={result.image_urls || []}
        renderQuality={result.render_quality || ''}
        quality={lastRequest?.quality}
        frameRate={lastRequest?.videoConfig?.frameRate}
        onCodeChange={onCodeChange}
        onRerender={onRerender}
        onAiModify={onAiModifyOpen}
        onNewContent={onResetAll}
        isBusy={isBusy}
      />
    </div>
  );
}
