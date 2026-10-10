import type { StudioKind } from '../features/studio/protocol/studio-agent-types';
import { useEffect, useRef, useState } from 'react';
import type { JobResult, OutputMode, Quality, ReferenceImage } from '../shared/types/api';
import { useGeneration } from '../features/workflow/hooks/useGeneration';
import { useProblemFraming } from '../features/workflow/hooks/useProblemFraming';
import { useGame2048 } from '../features/workflow/hooks/useGame2048';
import { useTabTitle } from '../shared/hooks/useTabTitle';
import { AiModifyModal } from '../features/workflow/components/AiModifyModal';
import { DonationModal } from '../features/donation/DonationModal';
import { AccessGate } from '../features/connection/AccessGate';
import { SettingsPage } from '../features/settings/SettingsPage';
import { PromptSettings } from '../features/prompts/PromptSettings';
import { StudioPage } from './routes/StudioPage';
import { Game2048Page } from '../features/workflow/pages/Game2048Page';
import { StudioShell } from '../features/studio/StudioShell';

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

function App() {
  const { status, result, error, jobId, stage, submittedAt, generate, renderWithCode, modifyWithAI, reset, cancel, cancelAndReset } = useGeneration();
  const problemFraming = useProblemFraming();
  const game = useGame2048();
  useTabTitle(status, stage);

  const [overlay, setOverlay] = useState<'settings' | 'prompts' | null>(null);
  const [overlayClosing, setOverlayClosing] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);
  const [aiModifyOpen, setAiModifyOpen] = useState(false);
  const [currentCode, setCurrentCode] = useState('');
  const [concept, setConcept] = useState('');
  const [lastCompletedResult, setLastCompletedResult] = useState<JobResult | null>(null);
  const [screen, setScreen] = useState<Screen>('classic');
  const [exitSliding, setExitSliding] = useState(false);
  const [activeStudioKind, setActiveStudioKind] = useState<StudioKind>('manim');
  const [entering, setEntering] = useState(false);
  const transitionTimerRef = useRef<number | null>(null);
  const [problemAdjustment, setProblemAdjustment] = useState('');
  const [lastRequest, setLastRequest] = useState<{
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
    renderCacheKey: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status === 'completed' && result) {
      setLastCompletedResult(result);
    }
  }, [result, status]);

  const resetAll = () => {
    reset();
    setCurrentCode('');
    setConcept('');
    setLastRequest(null);
    setAiModifyOpen(false);
    setLastCompletedResult(null);
    setScreen('classic');
    setActiveStudioKind('manim');
    setEntering(false);
    setProblemAdjustment('');
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    problemFraming.reset();
  };

  const handleOpenStudio = (studioKind: StudioKind) => {
    if (entering || exitSliding || screen === 'manim-studio' || screen === 'plot-studio') {
      return;
    }

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

  const handleSubmit = (data: {
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  }) => {
    setLastCompletedResult(null);
    setConcept(data.concept);
    setProblemAdjustment('');
    void problemFraming.startPlan({ request: data });
  };

  const handleBackToHome = () => {
    if (status === 'processing' || status === 'cancelling') {
      cancelAndReset();
      return;
    }
    setLastCompletedResult(null);
    reset();
  };

  const handleProblemRetry = () => {
    if (!problemAdjustment.trim()) {
      return;
    }
    void problemFraming.refinePlan({ feedback: problemAdjustment.trim() });
  };

  const handleProblemInitialRetry = () => {
    void problemFraming.retryPlan();
  };

  const handleProblemGenerate = () => {
    if (!problemFraming.draft || !problemFraming.plan) {
      return;
    }
    const draft = problemFraming.draft;
    const problemPlan = problemFraming.plan;
    const renderCacheKey = createClassicRenderCacheKey();
    setLastCompletedResult(null);
    setLastRequest({ ...draft, renderCacheKey });
    setConcept(draft.concept);
    setCurrentCode('');
    setProblemAdjustment('');
    problemFraming.reset();
    generate({ ...draft, problemPlan, renderCacheKey });
  };

  const handleProblemClose = () => {
    setProblemAdjustment('');
    problemFraming.reset();
  };

  const handleRerender = () => {
    const code = currentCode.trim() || result?.code?.trim() || lastCompletedResult?.code?.trim() || '';
    if (!lastRequest || !code) {
      return;
    }

    setCurrentCode('');
    renderWithCode({ ...lastRequest, code });
  };

  const handleAiModifySubmit = (instructions: string) => {
    const code = currentCode.trim() || result?.code?.trim() || lastCompletedResult?.code?.trim() || '';
    if (!lastRequest || !code) {
      return;
    }

    setAiModifyOpen(false);
    setCurrentCode('');
    modifyWithAI({
      concept: lastRequest.concept,
      outputMode: lastRequest.outputMode,
      quality: lastRequest.quality,
      instructions,
      code,
      renderCacheKey: lastRequest.renderCacheKey,
    });
  };

  const handleOpenGame = () => {
    if (status !== 'processing' && status !== 'cancelling') {
      return;
    }
    setScreen('game');
  };

  const isBusy = status === 'processing' || status === 'cancelling';
  const displayResult = result ?? lastCompletedResult;

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
            submittedAt={submittedAt}
            concept={concept}
            currentCode={currentCode || result?.code || ''}
            isBusy={isBusy}
            lastRequest={lastRequest}
            onConceptChange={setConcept}
            onSecretStudioOpen={handleOpenStudio}
            onSubmit={handleSubmit}
            onCodeChange={setCurrentCode}
            onRerender={handleRerender}
            onAiModifyOpen={() => setAiModifyOpen(true)}
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
    <AccessGate>
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
        loading={isBusy}
        onClose={() => setAiModifyOpen(false)}
        onSubmit={handleAiModifySubmit}
      />
    </div>
    </AccessGate>
  );
}

export default App;
