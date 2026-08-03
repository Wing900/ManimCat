import { useEffect, useState } from 'react';
import type { SettingsConfig } from '../../types/api';
import { loadSettings } from '../../lib/settings';
import { getActiveProvider, providerToCustomApiConfig } from '../../lib/ai-providers';
import type { TabType, TestResult } from './types';
import { useI18n } from '../../i18n';
import { useSettingsAutosave } from '../../lib/use-settings-autosave';

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
  const [config, setConfig] = useState<SettingsConfig>(() => loadSettings());
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [activeTab, setActiveTab] = useState<TabType>('api');

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const reloadTimer = window.setTimeout(() => {
      setConfig(loadSettings());
      setTestResult({ status: 'idle', message: '' });
    });

    return () => window.clearTimeout(reloadTimer);
  }, [isOpen]);

  useSettingsAutosave({ config, isOpen, onSave });

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

    const activeProvider = getActiveProvider(config.api);
    const customApiConfig = providerToCustomApiConfig(activeProvider);

    setTestResult({ status: 'testing', message: t('settings.test.testing'), details: {} });

    const startTime = performance.now();
    try {
      const response = await fetch('/api/ai/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${manimcatKey}`,
        },
        body: JSON.stringify(customApiConfig ? { customApiConfig } : {}),
      });

      const duration = Math.round(performance.now() - startTime);

      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as { warning?: unknown } | null;
        const warning = payload && typeof payload.warning === 'string' ? payload.warning : '';

        setTestResult({
          status: 'success',
          message: warning ? `${t('settings.test.success', { duration })} — ${warning}` : t('settings.test.success', { duration }),
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
