import { useEffect, useRef, useState } from 'react';
import type { OutputMode, Quality, ReferenceImage } from './types/api';
import { useGeneration } from './hooks/useGeneration';
import { useProblemFraming } from './hooks/useProblemFraming';
import { useGame2048 } from './hooks/useGame2048';
import { useTabTitle } from './hooks/useTabTitle';
import { AiModifyModal } from './components/AiModifyModal';
import { SettingsModal } from './components/SettingsModal';
import { DonationModal } from './components/DonationModal';
import { ProviderConfigModal } from './components/ProviderConfigModal';
import { Workspace } from './components/Workspace';
import { StudioPage } from './pages/StudioPage';
import { Game2048Page } from './pages/Game2048Page';
import { StudioShell } from './studio/StudioShell';
import { StudioTransitionOverlay } from './studio/StudioTransitionOverlay';
import { useI18n } from './i18n';

type Screen = 'classic' | 'studio' | 'game';

const STUDIO_TRANSITION_MS = 2000;
const STUDIO_EXIT_DELAY_MS = 800;

function App() {
  const { status, result, error, jobId, stage, generate, renderWithCode, modifyWithAI, reset, cancel } = useGeneration();
  const problemFraming = useProblemFraming();
  const game = useGame2048();
  useTabTitle(status, stage);
  const { t } = useI18n();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [aiModifyOpen, setAiModifyOpen] = useState(false);
  const [aiModifyInput, setAiModifyInput] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [concept, setConcept] = useState('');
  const [screen, setScreen] = useState<Screen>('classic');
  const [studioTransitionVisible, setStudioTransitionVisible] = useState(false);
  const [studioIsExiting, setStudioIsExiting] = useState(false);
  const [studioShellExiting, setStudioShellExiting] = useState(false);
  const [isReturningFromStudio, setIsReturningFromStudio] = useState(false);
  const [problemAdjustment, setProblemAdjustment] = useState('');
  const studioTransitionTimerRef = useRef<number | null>(null);
  const [lastRequest, setLastRequest] = useState<{
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  } | null>(null);

  useEffect(() => {
    if (result?.code) {
      setCurrentCode(result.code);
    }
  }, [result?.code]);

  useEffect(() => {
    return () => {
      if (studioTransitionTimerRef.current) {
        window.clearTimeout(studioTransitionTimerRef.current);
      }
    };
  }, []);

  const resetAll = () => {
    reset();
    setCurrentCode('');
    setConcept('');
    setLastRequest(null);
    setAiModifyInput('');
    setAiModifyOpen(false);
    setScreen('classic');
    setStudioTransitionVisible(false);
    setStudioIsExiting(false);
    setStudioShellExiting(false);
    setProblemAdjustment('');
    if (studioTransitionTimerRef.current) {
      window.clearTimeout(studioTransitionTimerRef.current);
      studioTransitionTimerRef.current = null;
    }
    problemFraming.reset();
  };

  const handleOpenStudio = () => {
    if (studioTransitionVisible || screen === 'studio') {
      return;
    }

    setStudioIsExiting(false);
    setStudioShellExiting(false);
    setStudioTransitionVisible(true);
    
    studioTransitionTimerRef.current = window.setTimeout(() => {
      setConcept('');
      setScreen('studio');
      
      studioTransitionTimerRef.current = window.setTimeout(() => {
        setStudioIsExiting(true);
        
        studioTransitionTimerRef.current = window.setTimeout(() => {
          setStudioTransitionVisible(false);
          setStudioIsExiting(false);
          studioTransitionTimerRef.current = null;
        }, STUDIO_EXIT_DELAY_MS);
      }, 300);
    }, STUDIO_TRANSITION_MS);
  };

  const handleExitStudio = () => {
    if (studioTransitionVisible) return;

    setStudioIsExiting(false);
    setStudioShellExiting(true); // Studio 界面开始退场动画
    setStudioTransitionVisible(true); // 遮罩开始升起

    studioTransitionTimerRef.current = window.setTimeout(() => {
      setScreen('classic');
      setStudioShellExiting(false);
      setIsReturningFromStudio(true); // 开启 Classic 入场动画
      
      studioTransitionTimerRef.current = window.setTimeout(() => {
        setStudioIsExiting(true);
        
        studioTransitionTimerRef.current = window.setTimeout(() => {
          setStudioTransitionVisible(false);
          setStudioIsExiting(false);
          setIsReturningFromStudio(false);
          studioTransitionTimerRef.current = null;
        }, STUDIO_EXIT_DELAY_MS);
      }, 300);
    }, STUDIO_TRANSITION_MS);
  };

  const handleSubmit = (data: {
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  }) => {
    setConcept(data.concept);
    setProblemAdjustment('');
    void problemFraming.startPlan({ request: data });
  };

  const handleBackToHome = () => {
    reset();
  };

  const handleProblemRetry = () => {
    if (!problemAdjustment.trim()) {
      return;
    }
    void problemFraming.refinePlan({ feedback: problemAdjustment.trim() });
  };

  const handleProblemGenerate = () => {
    if (!problemFraming.draft || !problemFraming.plan) {
      return;
    }
    const draft = problemFraming.draft;
    const problemPlan = problemFraming.plan;
    setLastRequest(draft);
    setConcept(draft.concept);
    setProblemAdjustment('');
    problemFraming.reset();
    generate({ ...draft, problemPlan });
  };

  const handleProblemClose = () => {
    setProblemAdjustment('');
    problemFraming.reset();
  };

  const handleRerender = () => {
    if (!lastRequest || !currentCode.trim()) {
      return;
    }

    renderWithCode({ ...lastRequest, code: currentCode });
  };

  const handleAiModifySubmit = () => {
    if (!lastRequest || !currentCode.trim()) {
      return;
    }

    const instructions = aiModifyInput.trim();
    if (!instructions) {
      return;
    }

    setAiModifyOpen(false);
    setAiModifyInput('');
    modifyWithAI({
      concept: lastRequest.concept,
      outputMode: lastRequest.outputMode,
      quality: lastRequest.quality,
      instructions,
      code: currentCode,
    });
  };

  const handleOpenGame = () => {
    if (status !== 'processing') {
      return;
    }
    setScreen('game');
  };

  const isBusy = status === 'processing';

  return (
    <div className="min-h-screen bg-bg-primary transition-colors duration-300 overflow-x-hidden">
      {screen === 'classic' ? (
        <div className={isReturningFromStudio ? 'animate-classic-entrance' : ''}>
          <StudioPage
            status={status}
            result={result}
            error={error}
            jobId={jobId}
            stage={stage}
            concept={concept}
            currentCode={currentCode}
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
            onOpenProviders={() => setProvidersOpen(true)}
            onOpenWorkspace={() => setWorkspaceOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenGame={handleOpenGame}
            problemOpen={problemFraming.status !== 'idle'}
            problemStatus={problemFraming.status === 'idle' ? 'loading' : problemFraming.status}
            problemPlan={problemFraming.plan}
            problemError={problemFraming.error}
            problemAdjustment={problemAdjustment}
            onProblemAdjustmentChange={setProblemAdjustment}
            onProblemRetry={handleProblemRetry}
            onProblemClose={handleProblemClose}
            onProblemGenerate={handleProblemGenerate}
          />
        </div>
      ) : screen === 'studio' ? (
        <StudioShell onExit={handleExitStudio} isExiting={studioShellExiting} />
      ) : (
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
      )}

      <StudioTransitionOverlay visible={studioTransitionVisible} isExiting={studioIsExiting} />

      <style>{`
        @keyframes fadeInUp {
          0% { opacity: 0; transform: translateY(30px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onSave={(config) => console.log(t('app.settingsSaved'), config)} />
      <DonationModal isOpen={donationOpen} onClose={() => setDonationOpen(false)} />
      <ProviderConfigModal isOpen={providersOpen} onClose={() => setProvidersOpen(false)} onSave={(config) => console.log(t('app.settingsSaved'), config)} />
      <Workspace isOpen={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
      <AiModifyModal
        isOpen={aiModifyOpen}
        value={aiModifyInput}
        loading={isBusy}
        onChange={setAiModifyInput}
        onClose={() => setAiModifyOpen(false)}
        onSubmit={handleAiModifySubmit}
      />
    </div>
  );
}

export default App;
