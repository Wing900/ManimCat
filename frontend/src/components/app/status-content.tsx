import { InputForm } from '../InputForm';
import { LoadingSpinner } from '../LoadingSpinner';
import { ResultSection } from '../ResultSection';
import type { JobResult, OutputMode, ProcessingStage, Quality, ReferenceImage } from '../../types/api';
import { useI18n } from '../../i18n';

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
  concept: string;
  onConceptChange: (value: string) => void;
  onSecretStudioOpen?: () => void;
  currentCode: string;
  isBusy: boolean;
  lastRequest: LastRequest | null;
  onSubmit: (data: LastRequest) => void;
  onCodeChange: (code: string) => void;
  onRerender: () => void;
  onAiModifyOpen: () => void;
  onResetAll: () => void;
  onBackToHome: () => void;
  onCancel: () => void;
  onOpenProviders: () => void;
  onOpenGame: () => void;
}

function shouldShowProviderConfigHint(message: string | null): boolean {
  if (!message) {
    return false;
  }

  return (
    message.includes('MANIMCAT_ROUTE_API_URLS') ||
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
  onOpenProviders,
  onOpenGame,
}: StatusContentProps) {
  const { t } = useI18n();

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

  if (status === 'processing') {
    return (
      <div className="animate-fade-in-soft bg-bg-secondary/20 rounded-2xl p-8">
        <LoadingSpinner stage={stage} jobId={jobId || undefined} onCancel={onCancel} onOpenGame={onOpenGame} />
      </div>
    );
  }

  if (status === 'completed' && result) {
    return (
      <div
        className="max-w-5xl mx-auto space-y-6 animate-fade-in"
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
            {t('result.newContent')}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    const showProviderConfigHint = shouldShowProviderConfigHint(error);
    const shownError = showProviderConfigHint
      ? t('result.error.noBackendModelConfigured')
      : (error || t('result.errorFallback'));

    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in" style={{ animation: 'fadeInUp 0.4s ease-out forwards' }}>
        <div className="relative bg-red-50/80 dark:bg-red-900/20 rounded-2xl p-6 pb-11 border border-red-200/60 dark:border-red-500/25">
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

          {showProviderConfigHint && (
            <button
              type="button"
              onClick={onOpenProviders}
              className="absolute left-6 bottom-4 text-xs text-red-700/80 dark:text-red-300/85 hover:text-red-700 dark:hover:text-red-200 underline underline-offset-2 transition-colors"
            >
              {t('result.error.configureCustomModel')}
            </button>
          )}
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
