import type { StudioKind } from '../features/studio/protocol/studio-agent-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobResult, OutputMode, Quality, ReferenceImage, RenderTarget, VideoConfig } from '../shared/types/api';
import { useGeneration } from '../features/workflow/hooks/useGeneration';
import { useProblemFraming } from '../features/workflow/hooks/useProblemFraming';
import { useGame2048 } from '../features/workflow/hooks/useGame2048';
import { useTabTitle } from '../shared/hooks/useTabTitle';
import { useI18n } from '../shared/i18n/index';
import { preflightBrowserRender, type BrowserRenderPreflightResult } from '../features/browser-rendering';
import { AiModifyModal } from '../features/workflow/components/AiModifyModal';
import { DonationModal } from '../features/donation/DonationModal';
import { ConnectionGuide, type GuideStep } from '../features/connection/ConnectionGuide';
import type { ConnectionIssue } from '../features/connection/connection-errors';
import { hasConnection } from '../features/connection/connection-types';
import { loadStudioDataMode } from '../infrastructure/api/runtime-config';
import { loadSettings, resolveRenderTarget } from '../infrastructure/storage/settings';
import { loadConnection, saveConnection, useConnection } from '../features/connection/connection-storage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { PromptSettings } from '../features/prompts/PromptSettings';
import { StudioPage } from './routes/StudioPage';
import { Game2048Page } from '../features/workflow/pages/Game2048Page';
import { StudioShell } from '../features/studio/StudioShell';
import { clearWorkflowDraft, updateWorkflowDraft, useWorkflowDraft } from '../features/workflow/input-form/workflow-draft';

type Screen = 'classic' | 'manim-studio' | 'plot-studio' | 'game';

const PAGE_ENTRY_MS = 700
const PAGE_SLIDE_MS = 400

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function createClassicRenderCacheKey(): string {
  return `classic-${crypto.randomUUID()}`;
}

type BrowserPreflightUi =
  | { status: 'idle'; message: null }
  | { status: 'checking'; message: null }
  | { status: 'error'; message: string };

function App() {
  const { status, result, error, jobId, stage, stageHistory, submittedAt, generate, renderWithCode, modifyWithAI, reset, cancel, cancelAndReset } = useGeneration();
  const { t } = useI18n();
  const [guideForced, setGuideForced] = useState(false);
  const [guideStep, setGuideStep] = useState<GuideStep>('choice');
  const connection = useConnection();
  // 两种连接问题都用弹窗：没配就从选择页开始，配过但被拒就直接落到对应的表单上。
  const handleConnectionIssue = useCallback((issue: ConnectionIssue) => {
    setGuideStep(issue === 'invalid' ? (connection.activeMode ?? 'choice') : 'choice');
    setGuideForced(true);
  }, [connection.activeMode]);
  const problemFraming = useProblemFraming({ onConnectionIssue: handleConnectionIssue });
  const game = useGame2048();
  useTabTitle(status, stage);

  const [overlay, setOverlay] = useState<'settings' | 'prompts' | null>(null);
  const [overlayClosing, setOverlayClosing] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);
  const [aiModifyOpen, setAiModifyOpen] = useState(false);
  const [aiModifyPreflightLoading, setAiModifyPreflightLoading] = useState(false);
  const [aiModifyError, setAiModifyError] = useState<string | null>(null);
  const aiModifyPreflightSeqRef = useRef(0);
  const [currentCode, setCurrentCode] = useState('');
  const { concept } = useWorkflowDraft();
  const [browserPreflight, setBrowserPreflight] = useState<BrowserPreflightUi>({
    status: 'idle',
    message: null,
  });
  const setConcept = useCallback((concept: string) => {
    updateWorkflowDraft({ concept });
    setBrowserPreflight((previous) => previous.status === 'error'
      ? { status: 'idle', message: null }
      : previous);
  }, []);
  const pendingRenderTargetRef = useRef<RenderTarget>('cloud');
  const preflightSequenceRef = useRef(0);
  const [lastCompletedResult, setLastCompletedResult] = useState<JobResult | null>(null);
  const [screen, setScreen] = useState<Screen>('classic');
  const [exitSliding, setExitSliding] = useState(false);
  const [activeStudioKind, setActiveStudioKind] = useState<StudioKind>('manim');
  const [entering, setEntering] = useState(false);
  const [classicReturning, setClassicReturning] = useState(false);
  const transitionTimerRef = useRef<number | null>(null);
  const classicReturnTimerRef = useRef<number | null>(null);
  const [problemAdjustment, setProblemAdjustment] = useState('');
  const [lastRequest, setLastRequest] = useState<{
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
    videoConfig?: VideoConfig;
    renderCacheKey: string;
    renderTarget?: RenderTarget;
  } | null>(null);

  useEffect(() => {
    // 部署形态在启动时问一次：UI 的两个装配点读这个已解析的值，所以在打开工作区之前就该有答案。
    // 失败时它保持 `server`，所以这里不需要 await，也不需要错误分支。
    void loadStudioDataMode();
  }, []);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current);
      }
      if (classicReturnTimerRef.current) {
        window.clearTimeout(classicReturnTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status === 'completed' && result) {
      setLastCompletedResult(result);
    }
  }, [result, status]);

  const clearClassicReturn = () => {
    if (classicReturnTimerRef.current) {
      window.clearTimeout(classicReturnTimerRef.current);
      classicReturnTimerRef.current = null;
    }
    setClassicReturning(false);
  };

  const triggerClassicReturn = () => {
    if (readPrefersReducedMotion()) {
      setClassicReturning(false);
      return;
    }
    clearClassicReturn();
    setClassicReturning(true);
    classicReturnTimerRef.current = window.setTimeout(() => {
      setClassicReturning(false);
      classicReturnTimerRef.current = null;
    }, PAGE_SLIDE_MS);
  };

  const resetAll = () => {
    reset();
    setCurrentCode('');
    clearWorkflowDraft();
    setLastRequest(null);
    setAiModifyOpen(false);
    setAiModifyPreflightLoading(false);
    setAiModifyError(null);
    aiModifyPreflightSeqRef.current += 1;
    setLastCompletedResult(null);
    setScreen('classic');
    setActiveStudioKind('manim');
    setEntering(false);
    setProblemAdjustment('');
    pendingRenderTargetRef.current = 'cloud';
    preflightSequenceRef.current += 1;
    setBrowserPreflight({ status: 'idle', message: null });
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    triggerClassicReturn();
    problemFraming.reset();
  };

  const handleOpenStudio = (studioKind: StudioKind) => {
    if (entering || exitSliding || screen === 'manim-studio' || screen === 'plot-studio') {
      return;
    }
    clearClassicReturn();

    setActiveStudioKind(studioKind);
    const target = studioKind === 'matplotlib' ? 'plot-studio' : 'manim-studio';

    if (readPrefersReducedMotion()) {
      setScreen(target);
      return;
    }

    // The studio mounts immediately and its parts assemble in a stagger (see `data-assemble` in
    // index.css); the home fades out underneath. What actually needs waiting stays local to the stage.
    setEntering(true);
    setScreen(target);
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      setEntering(false);
      transitionTimerRef.current = null;
    }, PAGE_ENTRY_MS);
  };

  const handleExitStudio = () => {
    if (entering || exitSliding) return;

    if (readPrefersReducedMotion()) {
      setScreen('classic');
      return;
    }

    // Exit has nothing to wait for: a horizontal slide (iOS pop) — the studio slides right off-screen
    // while the home slides in from the left. No blur, no hold, no ghost.
    setExitSliding(true);
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      setScreen('classic');
      setExitSliding(false);
      transitionTimerRef.current = null;
    }, PAGE_SLIDE_MS);
  };

  /**
   * Leaving Settings / Prompts borrows the studio's exit: the page slides off to the right (iOS pop)
   * while the screen underneath slides back in from the left. App owns both halves so the two
   * movements stay in step; the page itself only picks the outgoing class.
   */
  const closeOverlay = () => {
    if (readPrefersReducedMotion()) {
      setOverlay(null);
      return;
    }

    setOverlayClosing(true);
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      setOverlay(null);
      setOverlayClosing(false);
      transitionTimerRef.current = null;
    }, PAGE_SLIDE_MS);
  };

  const describePreflightFailure = useCallback((result: Extract<BrowserRenderPreflightResult, { ok: false }>): string => {
    if (result.stage === 'config') {
      if (result.reason === 'missing') return t('browser.preflight.configMissing');
      if (result.reason === 'insecure-context' || result.reason === 'host-insecure') {
        return t('browser.preflight.insecure');
      }
      return t('browser.preflight.configInvalid');
    }
    return t('browser.preflight.unsupported');
  }, [t]);

  const handleSubmit = (data: {
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  }) => {
    if (!hasConnection(connection)) {
      setGuideStep('choice');
      setGuideForced(true);
      return;
    }

    const requestedTarget = resolveRenderTarget(loadSettings());
    const sequence = ++preflightSequenceRef.current;
    setBrowserPreflight({ status: 'idle', message: null });

    const begin = () => {
      setLastCompletedResult(null);
      setConcept(data.concept);
      setProblemAdjustment('');
      void problemFraming.startPlan({ request: data });
    };

    if (requestedTarget !== 'browser') {
      pendingRenderTargetRef.current = 'cloud';
      begin();
      return;
    }

    setBrowserPreflight({ status: 'checking', message: null });
    void (async () => {
      try {
        const preflight = await preflightBrowserRender();
        if (sequence !== preflightSequenceRef.current) return;
        if (!preflight.ok) {
          setBrowserPreflight({
            status: 'error',
            message: describePreflightFailure(preflight),
          });
          return;
        }
        pendingRenderTargetRef.current = 'browser';
        setBrowserPreflight({ status: 'idle', message: null });
        begin();
      } catch {
        if (sequence !== preflightSequenceRef.current) return;
        setBrowserPreflight({ status: 'error', message: t('browser.preflight.failed') });
      }
    })();
  };

  const handleBackToHome = () => {
    preflightSequenceRef.current += 1;
    pendingRenderTargetRef.current = 'cloud';
    setBrowserPreflight({ status: 'idle', message: null });
    setAiModifyPreflightLoading(false);
    setAiModifyError(null);
    aiModifyPreflightSeqRef.current += 1;
    if (status === 'processing' || status === 'cancelling') {
      cancelAndReset();
      return;
    }
    setLastCompletedResult(null);
    reset();
    triggerClassicReturn();
  };

  const handleProblemRetry = () => {
    if (!hasConnection(connection)) {
      setGuideStep('choice');
      setGuideForced(true);
      return;
    }
    if (!problemAdjustment.trim()) {
      return;
    }
    void problemFraming.refinePlan({ feedback: problemAdjustment.trim() });
  };

  const handleProblemInitialRetry = () => {
    if (!hasConnection(connection)) {
      setGuideStep('choice');
      setGuideForced(true);
      return;
    }
    void problemFraming.retryPlan();
  };

  const handleProblemGenerate = () => {
    if (!problemFraming.draft || !problemFraming.plan) {
      return;
    }
    const draft = problemFraming.draft;
    const problemPlan = problemFraming.plan;
    const renderCacheKey = createClassicRenderCacheKey();
    const videoConfig = { ...loadSettings().video };
    const renderTarget = pendingRenderTargetRef.current;
    setLastCompletedResult(null);
    setLastRequest({ ...draft, renderCacheKey, videoConfig, renderTarget });
    setConcept(draft.concept);
    setCurrentCode('');
    setProblemAdjustment('');
    problemFraming.reset();
    generate({ ...draft, problemPlan, renderCacheKey, videoConfig, renderTarget });
  };

  const handleProblemClose = () => {
    setProblemAdjustment('');
    problemFraming.reset();
  };

  const handleRerender = (quality?: Quality, frameRate?: number, burnSubtitles = false) => {
    const code = currentCode.trim() || result?.code?.trim() || lastCompletedResult?.code?.trim() || '';
    if (!lastRequest || !code) {
      return;
    }

    const baseVideoConfig = lastRequest.videoConfig ?? loadSettings().video;
    const cleanBase = { ...baseVideoConfig };
    delete cleanBase.burnSubtitles;
    const nextQuality = quality ?? lastRequest.quality;
    const nextFrameRate = frameRate ?? cleanBase.frameRate;
    const videoConfig = { ...cleanBase, quality: nextQuality, frameRate: nextFrameRate };
    // Burning is a per-download choice, not a sticky setting: the request carries it,
    // while the request remembered for later rerenders stays clean.
    const requestVideoConfig = burnSubtitles ? { ...videoConfig, burnSubtitles: true } : videoConfig;
    const renderTarget = lastRequest.renderTarget ?? 'cloud';
    setLastRequest({ ...lastRequest, quality: nextQuality, videoConfig, renderTarget });
    renderWithCode({ ...lastRequest, quality: nextQuality, videoConfig: requestVideoConfig, code, renderTarget });
  };

  const handleOpenAiModify = () => {
    aiModifyPreflightSeqRef.current += 1;
    setAiModifyError(null);
    setAiModifyPreflightLoading(false);
    setAiModifyOpen(true);
  };

  const handleAiModifySubmit = (instructions: string) => {
    const code = currentCode.trim() || result?.code?.trim() || lastCompletedResult?.code?.trim() || '';
    if (!lastRequest || !code) {
      return;
    }

    const renderTarget = lastRequest.renderTarget ?? 'cloud';
    const submit = () => {
      setAiModifyOpen(false);
      setAiModifyError(null);
      setAiModifyPreflightLoading(false);
      setCurrentCode('');
      modifyWithAI({
        concept: lastRequest.concept,
        referenceImages: lastRequest.referenceImages,
        outputMode: lastRequest.outputMode,
        quality: lastRequest.quality,
        instructions,
        code,
        videoConfig: lastRequest.videoConfig,
        renderCacheKey: lastRequest.renderCacheKey,
        renderTarget,
      });
    };

    if (renderTarget !== 'browser') {
      submit();
      return;
    }

    const sequence = ++aiModifyPreflightSeqRef.current;
    setAiModifyError(null);
    setAiModifyPreflightLoading(true);
    void (async () => {
      try {
        const preflight = await preflightBrowserRender();
        if (sequence !== aiModifyPreflightSeqRef.current) return;
        if (!preflight.ok) {
          setAiModifyPreflightLoading(false);
          setAiModifyError(describePreflightFailure(preflight));
          return;
        }
        setAiModifyPreflightLoading(false);
        submit();
      } catch {
        if (sequence !== aiModifyPreflightSeqRef.current) return;
        setAiModifyPreflightLoading(false);
        setAiModifyError(t('browser.preflight.failed'));
      }
    })();
  };

  const handleOpenGame = () => {
    if (status !== 'processing' && status !== 'cancelling') {
      return;
    }
    setScreen('game');
  };

  const isBusy = status === 'processing' || status === 'cancelling';
  const displayResult = result ?? lastCompletedResult;

  // 引导页只在「没有连接、没被叉掉过、也没有别的页浮在上面」时出现。最后一条就是「先回主界面才弹」。
  // 引导页只在「没有连接、没被叉掉过、也没有别的页浮在上面」时自己浮出来；
  // 从提示条点「去设置」时无视这三条，用户已经明确要它了。
  const showGuide = guideForced || (!hasConnection(connection) && !connection.dismissed && overlay === null);
  const dismissGuide = () => {
    setGuideForced(false);
    saveConnection({ ...loadConnection(), dismissed: true });
  };

  const renderScreen = (name: Screen) => {
    if (name === 'classic') {
      return (
        <div>
          <StudioPage
            status={status}
            result={displayResult}
            error={error}
            jobId={jobId}
            stage={stage}
            stageHistory={stageHistory}
            submittedAt={submittedAt}
            returningHome={classicReturning}
            concept={concept}
            currentCode={currentCode || result?.code || ''}
            isBusy={isBusy}
            lastRequest={lastRequest}
            browserPreflightStatus={browserPreflight.status}
            browserPreflightMessage={browserPreflight.message}
            onConceptChange={setConcept}
            onSecretStudioOpen={handleOpenStudio}
            onSubmit={handleSubmit}
            onCodeChange={setCurrentCode}
            onRerender={handleRerender}
            onAiModifyOpen={handleOpenAiModify}
            onResetAll={resetAll}
            onBackToHome={handleBackToHome}
            onCancel={cancel}
            onOpenDonation={() => setDonationOpen(true)}
            onOpenPromptSettings={() => setOverlay('prompts')}
            onOpenSettings={() => setOverlay('settings')}
            onOpenGame={handleOpenGame}
            problemOpen={problemFraming.status !== 'idle'}
            problemStatus={problemFraming.status === 'idle' ? 'loading' : problemFraming.status}
            problemPlan={problemFraming.plan}
            problemError={problemFraming.error}
            problemAdjustment={problemAdjustment}
            onProblemAdjustmentChange={setProblemAdjustment}
            onProblemRetry={handleProblemRetry}
            onProblemInitialRetry={handleProblemInitialRetry}
            onProblemPlanChange={problemFraming.updatePlan}
            onProblemClose={handleProblemClose}
            onProblemGenerate={handleProblemGenerate}
          />
        </div>
      );
    }
    if (name === 'manim-studio') {
      return (
        <StudioShell
          onExit={handleExitStudio}
          studioKind={activeStudioKind}
          concept={concept}
        />
      );
    }
    if (name === 'plot-studio') {
      return <StudioShell onExit={handleExitStudio} studioKind="matplotlib" concept={concept} />;
    }
    return (
      <Game2048Page
        board={game.board}
        score={game.score}
        bestScore={game.bestScore}
        isGameOver={game.isGameOver}
        hasWon={game.hasWon}
        maxTile={game.maxTile}
        generationStatus={status}
        generationStage={stage}
        onMove={game.move}
        onRestart={game.restart}
        onBackToStudio={() => setScreen('classic')}
      />
    );
  };

  return (
    <div className="min-h-screen bg-bg-primary transition-colors duration-300 overflow-x-hidden">
      {exitSliding && (
        <div className="fixed inset-0 z-[90] overflow-hidden">
          <div className="absolute inset-0 page-slide-in">{renderScreen('classic')}</div>
        </div>
      )}
      {entering && screen !== 'classic' && (
        <div className="pointer-events-none fixed inset-0 z-[80] page-home-leave">
          {renderScreen('classic')}
        </div>
      )}
      <div
        className={
          exitSliding
            ? 'relative z-[95] page-slide-out'
            : entering
              ? 'relative z-[82] page-assemble'
              : overlayClosing
                ? 'page-slide-in'
                : ''
        }
      >
        {renderScreen(screen)}
      </div>

      <style>{`
        @keyframes fadeInUp {
          0% { opacity: 0; transform: translateY(30px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <DonationModal isOpen={donationOpen} onClose={() => setDonationOpen(false)} />
      {overlay === 'settings' && <SettingsPage exiting={overlayClosing} onClose={closeOverlay} />}
      {overlay === 'prompts' && <PromptSettings exiting={overlayClosing} onClose={closeOverlay} />}
      <AiModifyModal
        isOpen={aiModifyOpen}
        loading={isBusy || aiModifyPreflightLoading}
        error={aiModifyError}
        onClose={() => {
          aiModifyPreflightSeqRef.current += 1;
          setAiModifyOpen(false);
          setAiModifyPreflightLoading(false);
          setAiModifyError(null);
        }}
        onSubmit={handleAiModifySubmit}
      />

      {showGuide && (
        <ConnectionGuide
          initialStep={guideStep}
          immediate={guideForced}
          onDismiss={dismissGuide}
          onSaved={(next) => {
            setGuideForced(false);
            saveConnection({ ...next, dismissed: true });
          }}
        />
      )}

    </div>
  );
}

export default App;
