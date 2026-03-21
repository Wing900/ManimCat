import type { SettingsConfig } from '../types/api';
import { FloatingInput } from './settings-modal/FloatingInput';
import { TestResultBanner } from './settings-modal/test-result-banner';
import { VideoSettingsTab } from './settings-modal/video-settings-tab';
import { useSettingsModal } from './settings-modal/use-settings-modal';
import { useI18n } from '../i18n';
import { useModalTransition } from '../hooks/useModalTransition';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: SettingsConfig) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  if (!props.isOpen) {
    return null;
  }

  return <SettingsModalContent {...props} />;
}

function SettingsModalContent({ isOpen, onClose, onSave }: SettingsModalProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen);
  const {
    config,
    activeTab,
    testResult,
    setActiveTab,
    updateManimcatApiKey,
    updateVideoConfig,
    handleTestBackend,
  } = useSettingsModal({ onSave });

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md transition-opacity duration-300 ${
          isExiting ? 'opacity-0' : 'animate-overlay-wash-in'
        }`}
        onClick={onClose}
      />

      <div className={`relative bg-bg-secondary rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl border border-border/5 ${
        isExiting ? 'animate-fade-out-soft' : 'animate-fade-in-soft'
      }`}>
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
            <h2 className="text-xl font-medium text-text-primary tracking-tight">{t('settings.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 mb-8 p-1.5 bg-bg-secondary/50 border border-border/5 rounded-2xl">
          <button
            onClick={() => setActiveTab('api')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
              activeTab === 'api'
                ? 'text-text-primary bg-bg-secondary shadow-sm'
                : 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-secondary/30'
            }`}
          >
            {t('settings.tab.api')}
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
              activeTab === 'video'
                ? 'text-text-primary bg-bg-secondary shadow-sm'
                : 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-secondary/30'
            }`}
          >
            {t('settings.tab.video')}
          </button>
        </div>

        <div className="space-y-6">
          {activeTab === 'api' && (
            <div className="animate-fade-in flex flex-col gap-6">
              <FloatingInput
                id="manimcatApiKey"
                type="password"
                label={t('settings.api.manimcatKey')}
                value={config.api.manimcatApiKey}
                placeholder={t('settings.api.manimcatKeyPlaceholder')}
                onChange={updateManimcatApiKey}
                inputClassName="rounded-2xl"
              />
              <TestResultBanner testResult={testResult} />
            </div>
          )}
          {activeTab === 'video' && (
            <div className="animate-fade-in">
              <VideoSettingsTab videoConfig={config.video} onUpdate={updateVideoConfig} />
            </div>
          )}
        </div>

        <div className="mt-10 grid grid-cols-2 gap-4">
          <button
            onClick={onClose}
            className="px-6 py-4 text-sm font-medium text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-2xl transition-all active:scale-95"
          >
            {t('common.close')}
          </button>
          <button
            onClick={handleTestBackend}
            disabled={testResult.status === 'testing'}
            className="px-6 py-4 text-sm font-medium bg-accent text-bg-primary hover:bg-accent/90 rounded-2xl transition-all disabled:opacity-50 active:scale-95 shadow-md shadow-accent/10"
          >
            {t('settings.test')}
          </button>
        </div>
      </div>
    </div>
  );
}
