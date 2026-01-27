// 设置模态框 - MD3 风格

import { useState, useEffect } from 'react';
import { CustomSelect } from './CustomSelect';
import type { Quality, ApiConfig, VideoConfig, SettingsConfig } from '../types/api';

type TabType = 'api' | 'video';

interface TestResult {
  status: 'idle' | 'testing' | 'success' | 'error';
  message: string;
  details?: {
    statusCode?: number;
    statusText?: string;
    responseBody?: string;
    headers?: Record<string, string>;
    duration?: number;
    error?: string;
  };
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: SettingsConfig) => void;
}

/** 从 localStorage 加载配置 */
function loadConfig(): SettingsConfig {
  const saved = localStorage.getItem('manimcat_settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as SettingsConfig;
      return {
        api: parsed.api || { apiUrl: '', apiKey: '', model: '', manimcatApiKey: '' },
        video: parsed.video || { quality: 'medium', frameRate: 30, timeout: 600 }
      };
    } catch {
      return { api: { apiUrl: '', apiKey: '', model: '', manimcatApiKey: '' }, video: { quality: 'medium', frameRate: 30, timeout: 600 } };
    }
  }
  // 同时检查单独存储的 ManimCat API Key（兼容旧版本）
  const manimcatKey = localStorage.getItem('manimcat_api_key') || '';
  return { api: { apiUrl: '', apiKey: '', model: '', manimcatApiKey: manimcatKey }, video: { quality: 'medium', frameRate: 30, timeout: 600 } };
}

/** 保存配置到 localStorage */
function saveConfig(config: SettingsConfig): void {
  localStorage.setItem('manimcat_settings', JSON.stringify(config));
  // 单独保存 ManimCat API Key（用于 api.ts 的 getAuthHeaders，兼容旧版本）
  if (config.api.manimcatApiKey) {
    localStorage.setItem('manimcat_api_key', config.api.manimcatApiKey);
  } else {
    localStorage.removeItem('manimcat_api_key');
  }
}

export function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const [config, setConfig] = useState<SettingsConfig>({ api: { apiUrl: '', apiKey: '', model: '', manimcatApiKey: '' }, video: { quality: 'medium', frameRate: 30, timeout: 600 } });
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [activeTab, setActiveTab] = useState<TabType>('api');

  const updateApiConfig = (updates: Partial<ApiConfig>) => {
    setConfig(prev => ({ ...prev, api: { ...prev.api, ...updates } }));
  };

  const updateVideoConfig = (updates: Partial<VideoConfig>) => {
    setConfig(prev => ({ ...prev, video: { ...prev.video, ...updates } }));
  };

  useEffect(() => {
    if (isOpen) {
      setConfig(loadConfig());
      setTestResult({ status: 'idle', message: '' });
      setActiveTab('api');
    }
  }, [isOpen]);

  const handleSave = () => {
    saveConfig(config);
    onSave(config);
    onClose();
  };

  const handleTest = async () => {
    if (!config.api.apiUrl || !config.api.apiKey) {
      setTestResult({
        status: 'error',
        message: '请填写 API 地址和密钥',
      });
      return;
    }

    setTestResult({ status: 'testing', message: '测试中...', details: {} });

    const startTime = performance.now();
    const apiUrl = config.api.apiUrl.trim().replace(/\/+$/, '');

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.api.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.api.model.trim() || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 5,
        }),
      });

      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);

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
      } else {
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
      }
    } catch (error) {
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-secondary rounded-2xl p-8 max-w-md w-full shadow-xl">
        {/* 标题 */}
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

        {/* Tab 切换 */}
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

        {/* 表单 */}
        <div className="space-y-5">
          {/* API 设置 */}
          {activeTab === 'api' && (
            <>
              <div className="relative">
                <label
                  htmlFor="manimcatApiKey"
                  className="absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary transition-all"
                >
                  ManimCat API 密钥
                </label>
                <input
                  id="manimcatApiKey"
                  type="password"
                  value={config.api.manimcatApiKey}
                  onChange={(e) => updateApiConfig({ manimcatApiKey: e.target.value })}
                  placeholder="留空则跳过认证"
                  className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all"
                />
              </div>

              <div className="relative">
                <label
                  htmlFor="apiUrl"
                  className="absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary transition-all"
                >
                  API 地址
                </label>
                <input
                  id="apiUrl"
                  type="text"
                  value={config.api.apiUrl}
                  onChange={(e) => updateApiConfig({ apiUrl: e.target.value })}
                  placeholder="https://api.xiaomimimo.com/v1"
                  className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all"
                />
              </div>

              <div className="relative">
                <label
                  htmlFor="apiKey"
                  className="absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary transition-all"
                >
                  API 密钥
                </label>
                <input
                  id="apiKey"
                  type="password"
                  value={config.api.apiKey}
                  onChange={(e) => updateApiConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all"
                />
              </div>

              <div className="relative">
                <label
                  htmlFor="model"
                  className="absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary transition-all"
                >
                  模型名称
                </label>
                <input
                  id="model"
                  type="text"
                  value={config.api.model}
                  onChange={(e) => updateApiConfig({ model: e.target.value })}
                  placeholder="mimo-v2-flash"
                  className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all"
                />
              </div>

              {testResult.status !== 'idle' && (
                <div className={`rounded-2xl text-sm ${
                  testResult.status === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20'
                    : testResult.status === 'testing'
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'bg-red-50 dark:bg-red-900/20'
                }`}>
                  <div className={`p-4 ${
                    testResult.status === 'success'
                      ? 'text-green-600 dark:text-green-400'
                      : testResult.status === 'testing'
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {testResult.status === 'testing' && (
                      <div className="flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>{testResult.message}</span>
                      </div>
                    )}
                    {testResult.status !== 'testing' && (
                      <span>{testResult.message}</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 视频配置 */}
          {activeTab === 'video' && (
            <>
              <CustomSelect
                options={[
                  { value: 'low' as Quality, label: '低 (480p)' },
                  { value: 'medium' as Quality, label: '中 (720p)' },
                  { value: 'high' as Quality, label: '高 (1080p)' }
                ]}
                value={config.video.quality}
                onChange={(value) => updateVideoConfig({ quality: value })}
                label="默认值"
              />

              <CustomSelect
                options={[
                  { value: 15, label: '15 fps' },
                  { value: 30, label: '30 fps' },
                  { value: 60, label: '60 fps' }
                ]}
                value={config.video.frameRate}
                onChange={(value) => updateVideoConfig({ frameRate: value })}
                label="帧率"
              />

              <CustomSelect
                options={[
                  { value: 60, label: '1 分钟' },
                  { value: 120, label: '2 分钟' },
                  { value: 180, label: '3 分钟' },
                  { value: 300, label: '5 分钟' },
                  { value: 600, label: '10 分钟' }
                ]}
                value={config.video.timeout || 120}
                onChange={(value) => updateVideoConfig({ timeout: value })}
                label="生成超时"
              />
            </>
          )}
        </div>

        {/* 按钮 */}
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
