import type { OutputMode, ProcessingStage, Quality, ReferenceImage, JobResult } from '../types/api';
import ManimCatLogo from '../components/ManimCatLogo';
import { TopLeftActions } from '../components/app/top-left-actions';
import { TopRightActions } from '../components/app/top-right-actions';
import { StatusContent } from '../components/app/status-content';
import { TimingPanel } from '../components/TimingPanel';
import { ProblemFramingOverlay } from '../components/ProblemFramingOverlay';
import type { ProblemFramingPlan } from '../types/api';
import { useI18n } from '../i18n';

interface LastRequest {
  concept: string;
  quality: Quality;
  outputMode: OutputMode;
  referenceImages?: ReferenceImage[];
}

interface StudioPageProps {
  status: 'idle' | 'processing' | 'completed' | 'error';
  result: JobResult | null;
  error: string | null;
  jobId: string | null;
  stage: ProcessingStage;
  concept: string;
  currentCode: string;
  isBusy: boolean;
  lastRequest: LastRequest | null;
  onConceptChange: (value: string) => void;
  onSecretStudioOpen?: () => void;
  onSubmit: (data: LastRequest) => void;
  onCodeChange: (code: string) => void;
  onRerender: () => void;
  onAiModifyOpen: () => void;
  onResetAll: () => void;
  onBackToHome: () => void;
  onCancel: () => void;
  onOpenDonation: () => void;
  onOpenProviders: () => void;
  onOpenWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenGame: () => void;
  problemOpen: boolean;
  problemStatus: 'loading' | 'ready' | 'error';
  problemPlan: ProblemFramingPlan | null;
  problemError: string | null;
  problemAdjustment: string;
  onProblemAdjustmentChange: (value: string) => void;
  onProblemRetry: () => void;
  onProblemClose: () => void;
  onProblemGenerate: () => void;
}

export function StudioPage({
  status,
  result,
  error,
  jobId,
  stage,
  concept,
  currentCode,
  isBusy,
  lastRequest,
  onConceptChange,
  onSecretStudioOpen,
  onSubmit,
  onCodeChange,
  onRerender,
  onAiModifyOpen,
  onResetAll,
  onBackToHome,
  onCancel,
  onOpenDonation,
  onOpenProviders,
  onOpenWorkspace,
  onOpenSettings,
  onOpenGame,
  problemOpen,
  problemStatus,
  problemPlan,
  problemError,
  problemAdjustment,
  onProblemAdjustmentChange,
  onProblemRetry,
  onProblemClose,
  onProblemGenerate,
}: StudioPageProps) {
  const { t } = useI18n();
  const isCompleted = status === 'completed';

  return (
    <>
      <TopLeftActions onOpenDonation={onOpenDonation} onOpenProviders={onOpenProviders} />
      <TopRightActions onOpenWorkspace={onOpenWorkspace} onOpenSettings={onOpenSettings} />

      <div
        className={`mx-auto px-4 min-h-screen flex flex-col justify-center ${isCompleted ? 'max-w-5xl' : 'max-w-4xl'}`}
        style={isCompleted ? { paddingTop: '4vh', paddingBottom: '4vh' } : { paddingTop: '18vh', paddingBottom: '12vh' }}
      >
        {!isCompleted && (
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-4 mb-3">
              <ManimCatLogo className="w-16 h-16" />
              <h1 className="text-5xl sm:text-6xl font-light tracking-tight text-text-primary">ManimCat</h1>
            </div>
            <p className="text-sm text-text-secondary/70 max-w-lg mx-auto">{t('app.subtitle')}</p>
          </div>
        )}

        <div className="mb-6">
          <StatusContent
            status={status}
            result={result}
            error={error}
            jobId={jobId}
            stage={stage}
            concept={concept}
            onConceptChange={onConceptChange}
            onSecretStudioOpen={onSecretStudioOpen}
            currentCode={currentCode}
            isBusy={isBusy}
            lastRequest={lastRequest}
            onSubmit={onSubmit}
            onCodeChange={onCodeChange}
            onRerender={onRerender}
            onAiModifyOpen={onAiModifyOpen}
            onResetAll={onResetAll}
            onBackToHome={onBackToHome}
            onCancel={onCancel}
            onOpenProviders={onOpenProviders}
            onOpenGame={onOpenGame}
          />
        </div>
      </div>

      {status === 'completed' && result?.timings && <TimingPanel timings={result.timings} />}

      <ProblemFramingOverlay
        open={problemOpen}
        status={problemStatus}
        plan={problemPlan}
        error={problemError}
        adjustment={problemAdjustment}
        generating={isBusy}
        onAdjustmentChange={onProblemAdjustmentChange}
        onRetry={onProblemRetry}
        onGenerate={onProblemGenerate}
        onClose={onProblemClose}
      />

      <div
        aria-hidden="true"
        className="fixed right-4 bottom-4 z-30 pointer-events-none select-none text-[10px] font-medium uppercase tracking-[0.32em] text-text-secondary/25"
      >
        Bin
      </div>
    </>
  );
}
