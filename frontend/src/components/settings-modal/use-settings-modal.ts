import { useEffect, useState } from 'react';
import type { ApiConfig, SettingsConfig, VideoConfig } from '../../types/api';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../lib/settings';
import type { TabType, TestResult } from './types';

interface UseSettingsModalParams {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: SettingsConfig) => void;
}

interface UseSettingsModalResult {
  config: SettingsConfig;
  activeTab: TabType;
  testResult: TestResult;
  setActiveTab: (tab: TabType) => void;
  updateApiConfig: (updates: Partial<ApiConfig>) => void;
  updateVideoConfig: (updates: Partial<VideoConfig>) => void;
  handleSave: () => void;
  handleTest: () => Promise<void>;
}

export function useSettingsModal({
  isOpen,
  onClose,
  onSave,
}: UseSettingsModalParams): UseSettingsModalResult {
  const [config, setConfig] = useState<SettingsConfig>(DEFAULT_SETTINGS);
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [activeTab, setActiveTab] = useState<TabType>('api');

  useEffect(() => {
    if (isOpen) {
      setConfig(loadSettings());
      setTestResult({ status: 'idle', message: '' });
      setActiveTab('api');
    }
  }, [isOpen]);

  const updateApiConfig = (updates: Partial<ApiConfig>) => {
    setConfig((prev) => ({ ...prev, api: { ...prev.api, ...updates } }));
  };

  const updateVideoConfig = (updates: Partial<VideoConfig>) => {
    setConfig((prev) => ({ ...prev, video: { ...prev.video, ...updates } }));
  };

  const handleSave = () => {
    saveSettings(config);
    onSave(config);
    onClose();
  };

  const handleTest = async () => {
    const apiUrlInput = config.api.apiUrl.trim();
    const apiKeyInput = config.api.apiKey.trim();
    const modelInput = config.api.model.trim();
    const manimcatKey = config.api.manimcatApiKey.trim();
    const hasCustomConfig = Boolean(apiUrlInput || apiKeyInput || modelInput);

    if (!manimcatKey) {
      setTestResult({
        status: 'error',
        message: '请先填写 ManimCat API 密钥',
      });
      return;
    }

    if (hasCustomConfig && (!apiUrlInput || !apiKeyInput)) {
      setTestResult({
        status: 'error',
        message: '请填入 API 地址和密钥',
      });
      return;
    }

    setTestResult({ status: 'testing', message: '测试中...', details: {} });

    const startTime = performance.now();
    try {
      const response = await fetch('/api/ai/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${manimcatKey}`,
        },
        body: JSON.stringify(
          hasCustomConfig
            ? {
                customApiConfig: {
                  apiUrl: apiUrlInput,
                  apiKey: apiKeyInput,
                  model: modelInput,
                },
              }
            : {}
        ),
      });

      const duration = Math.round(performance.now() - startTime);

      if (response.ok) {
        setTestResult({
          status: 'success',
          message: `连接成功！(${duration}ms)`,
          details: {
            statusCode: response.status,
            statusText: response.statusText,
            duration,
          },
        });
        return;
      }

      const responseBody = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      setTestResult({
        status: 'error',
        message: `HTTP ${response.status}: ${response.statusText}`,
        details: {
          statusCode: response.status,
          statusText: response.statusText,
          responseBody: responseBody.slice(0, 2000),
          headers,
          duration,
        },
      });
    } catch (error) {
      const duration = Math.round(performance.now() - startTime);
      setTestResult({
        status: 'error',
        message: error instanceof Error ? error.message : '连接失败',
        details: {
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          duration,
        },
      });
    }
  };

  return {
    config,
    activeTab,
    testResult,
    setActiveTab,
    updateApiConfig,
    updateVideoConfig,
    handleSave,
    handleTest,
  };
}
