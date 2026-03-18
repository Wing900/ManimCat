// 主应用组件

import { useEffect, useState } from 'react';
import type { OutputMode, Quality, ReferenceImage } from './types/api';
import { useGeneration } from './hooks/useGeneration';
import { useTabTitle } from './hooks/useTabTitle';
import { TimingPanel } from './components/TimingPanel';
import { AiModifyModal } from './components/AiModifyModal';
import { SettingsModal } from './components/SettingsModal';
import { DonationModal } from './components/DonationModal';
import { ProviderConfigModal } from './components/ProviderConfigModal';
import { Workspace } from './components/Workspace';
import ManimCatLogo from './components/ManimCatLogo';
import { TopLeftActions } from './components/app/top-left-actions';
import { TopRightActions } from './components/app/top-right-actions';
import { StatusContent } from './components/app/status-content';
import { useI18n } from './i18n';

function App() {
  const { status, result, error, jobId, stage, generate, renderWithCode, modifyWithAI, reset, cancel } = useGeneration();
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

  const resetAll = () => {
    reset();
    setCurrentCode('');
    setConcept('');
    setLastRequest(null);
    setAiModifyInput('');
    setAiModifyOpen(false);
  };

  const handleSubmit = (data: {
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  }) => {
    setConcept(data.concept);
    setLastRequest(data);
    generate(data);
  };

  const handleBackToHome = () => {
    reset();
  };

  const handleRerender = () => {
    if (!lastRequest || !currentCode.trim()) return;
    renderWithCode({ ...lastRequest, code: currentCode });
  };

  const handleAiModifySubmit = () => {
    if (!lastRequest || !currentCode.trim()) return;
    const instructions = aiModifyInput.trim();
    if (!instructions) return;

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

  const isBusy = status === 'processing';
  const isCompleted = status === 'completed';

  return (
    <div className="min-h-screen bg-bg-primary transition-colors duration-300 overflow-x-hidden">
      <TopLeftActions onOpenDonation={() => setDonationOpen(true)} onOpenProviders={() => setProvidersOpen(true)} />
      <TopRightActions
        onOpenWorkspace={() => setWorkspaceOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

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
            onConceptChange={setConcept}
            currentCode={currentCode}
            isBusy={isBusy}
            lastRequest={lastRequest}
            onSubmit={handleSubmit}
            onCodeChange={setCurrentCode}
            onRerender={handleRerender}
            onAiModifyOpen={() => setAiModifyOpen(true)}
            onResetAll={resetAll}
            onBackToHome={handleBackToHome}
            onCancel={cancel}
            onOpenProviders={() => setProvidersOpen(true)}
          />
        </div>
      </div>

      {status === 'completed' && result?.timings && <TimingPanel timings={result.timings} />}

      <div
        aria-hidden="true"
        className="fixed right-4 bottom-4 z-30 pointer-events-none select-none text-[10px] font-medium uppercase tracking-[0.32em] text-text-secondary/25"
      >
        Bin
      </div>

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
