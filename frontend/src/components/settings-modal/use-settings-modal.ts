import { useEffect, useRef, useState } from 'react';
import type { SettingsConfig } from '../../types/api';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../lib/settings';
import type { TabType, TestResult } from './types';
import { useI18n } from '../../i18n';

interface UseSettingsModalParams {
  isOpen: boolean;
  onSave: (config: SettingsConfig) => void;
}

interface UseSettingsModalResult {
  config: SettingsConfig;
  activeTab: TabType;
  testResult: TestResult;
  setActiveTab: (tab: TabType) => void;
  updateManimcatApiKey: (value: string) => void;
  updateVideoConfig: (updates: Partial<SettingsConfig['video']>) => void;
  handleTestBackend: () => Promise<void>;
}

export function useSettingsModal({ isOpen, onSave }: UseSettingsModalParams): UseSettingsModalResult {
  const { t } = useI18n();
  const [config, setConfig] = useState<SettingsConfig>(DEFAULT_SETTINGS);
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [activeTab, setActiveTab] = useState<TabType>('api');
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setConfig(loadSettings());
    setTestResult({ status: 'idle', message: '' });
    setActiveTab('api');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      saveSettings(config);
      onSave(config);
    }, 500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [config, isOpen, onSave]);

  const updateManimcatApiKey = (value: string) => {
    setConfig((prev) => ({ ...prev, api: { ...prev.api, manimcatApiKey: value } }));
  };

  const updateVideoConfig = (updates: Partial<SettingsConfig['video']>) => {
    setConfig((prev) => ({ ...prev, video: { ...prev.video, ...updates } }));
  };

  const handleTestBackend = async () => {
    const manimcatKey = config.api.manimcatApiKey.trim();
    if (!manimcatKey) {
      setTestResult({ status: 'error', message: t('settings.test.needManimcatKey') });
      return;
    }

    setTestResult({ status: 'testing', message: t('settings.test.testing'), details: {} });

    const startTime = performance.now();
    try {
      const response = await fetch('/api/ai/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${manimcatKey}`,
        },
        body: JSON.stringify({}),
      });

      const duration = Math.round(performance.now() - startTime);

      if (response.ok) {
        setTestResult({
          status: 'success',
          message: t('settings.test.success', { duration }),
          details: { statusCode: response.status, statusText: response.statusText, duration },
        });
        return;
      }

      const responseBody = await response.text();
      setTestResult({
        status: 'error',
        message: `HTTP ${response.status}: ${response.statusText}`,
        details: {
          statusCode: response.status,
          statusText: response.statusText,
          responseBody: responseBody.slice(0, 2000),
          duration,
        },
      });
    } catch (error) {
      const duration = Math.round(performance.now() - startTime);
      setTestResult({
        status: 'error',
        message: error instanceof Error ? error.message : t('settings.test.failed'),
        details: { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), duration },
      });
    }
  };

  return {
    config,
    activeTab,
    testResult,
    setActiveTab,
    updateManimcatApiKey,
    updateVideoConfig,
    handleTestBackend,
  };
}

