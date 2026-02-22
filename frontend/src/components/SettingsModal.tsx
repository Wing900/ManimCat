// 设置模态框 - MD3 风格

import type { SettingsConfig } from '../types/api';
import { ApiSettingsTab } from './settings-modal/api-settings-tab';
import { VideoSettingsTab } from './settings-modal/video-settings-tab';
import { useSettingsModal } from './settings-modal/use-settings-modal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: SettingsConfig) => void;
}

export function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const {
    config,
    activeTab,
    testResult,
    setActiveTab,
    updateApiConfig,
    updateVideoConfig,
    handleSave,
    handleTest,
  } = useSettingsModal({ isOpen, onClose, onSave });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-secondary rounded-2xl p-8 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-medium text-text-primary">设置</h2>
          <button
            onClick={onClose}
            className="p-2 text-text-secondary/60 hover:text-text-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 mb-6 p-1 bg-bg-secondary/50 rounded-xl">
          <button
            onClick={() => setActiveTab('api')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'api'
                ? 'text-text-primary bg-bg-secondary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary/30'
            }`}
          >
            API 设置
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'video'
                ? 'text-text-primary bg-bg-secondary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary/30'
            }`}
          >
            视频配置
          </button>
        </div>

        <div className="space-y-5">
          {activeTab === 'api' && (
            <ApiSettingsTab apiConfig={config.api} testResult={testResult} onUpdate={updateApiConfig} />
          )}
          {activeTab === 'video' && (
            <VideoSettingsTab videoConfig={config.video} onUpdate={updateVideoConfig} />
          )}
        </div>

        <div className="mt-8 flex gap-3">
          <button
            onClick={handleTest}
            disabled={testResult.status === 'testing'}
            className="flex-1 px-6 py-3.5 text-sm font-medium text-accent hover:text-accent-hover bg-bg-secondary/50 hover:bg-bg-secondary/70 rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            测试连接
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-2xl transition-all focus:outline-none focus:ring-2 focus:ring-accent/20 shadow-lg shadow-accent/25"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
