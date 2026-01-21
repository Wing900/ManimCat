// 设置模态框 - MD3 风格

import { useState, useEffect } from 'react';

interface ApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

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
  onSave: (config: ApiConfig) => void;
}

/** 从 localStorage 加载配置 */
function loadConfig(): ApiConfig {
  const saved = localStorage.getItem('manimcat_api_config');
  if (saved) {
    try {
      return JSON.parse(saved) as ApiConfig;
    } catch {
      return { apiUrl: '', apiKey: '', model: '' };
    }
  }
  return { apiUrl: '', apiKey: '', model: '' };
}

/** 保存配置到 localStorage */
function saveConfig(config: ApiConfig): void {
  localStorage.setItem('manimcat_api_config', JSON.stringify(config));
}

export function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const [config, setConfig] = useState<ApiConfig>({ apiUrl: '', apiKey: '', model: '' });
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(loadConfig());
      setTestResult({ status: 'idle', message: '' });
      setShowDetails(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    saveConfig(config);
    onSave(config);
    onClose();
  };

  const handleTest = async () => {
    if (!config.apiUrl || !config.apiKey) {
      setTestResult({
        status: 'error',
        message: '请填写 API 地址和密钥',
      });
      return;
    }

    setTestResult({ status: 'testing', message: '测试中...', details: {} });
    setShowDetails(false);

    const startTime = performance.now();
    const apiUrl = config.apiUrl.trim().replace(/\/+$/, '');

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.model.trim() || 'gpt-4o-mini',
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
          <h2 className="text-xl font-medium text-text-primary">API 设置</h2>
          <button
            onClick={onClose}
            className="p-2 text-text-secondary/60 hover:text-text-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 表单 */}
        <div className="space-y-5">
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
              value={config.apiUrl}
              onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
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
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all"
            />
          </div>

          <div className="relative">
            <label
              htmlFor="model"
              className="absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary transition-all"
            >
              模型名称（可选）
            </label>
            <input
              id="model"
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="mimo-v2-flash"
              className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all"
            />
          </div>

          {/* 测试连接状态 */}
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
                  <div className="flex items-center justify-between">
                    <span>{testResult.message}</span>
                    {(testResult.details?.responseBody || testResult.details?.error) && (
                      <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="text-xs underline hover:no-underline"
                      >
                        {showDetails ? '隐藏详情' : '查看详情'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 详细错误信息 */}
              {showDetails && testResult.details && (
                <div className="px-4 pb-4">
                  <div className="bg-black/5 dark:bg-white/5 rounded-lg p-3 text-xs overflow-auto max-h-60">
                    {testResult.details.statusCode && (
                      <div className="mb-2">
                        <span className="font-medium">状态码: </span>
                        <span>{testResult.details.statusCode} {testResult.details.statusText}</span>
                      </div>
                    )}
                    {testResult.details.duration !== undefined && (
                      <div className="mb-2">
                        <span className="font-medium">耗时: </span>
                        <span>{testResult.details.duration}ms</span>
                      </div>
                    )}
                    {testResult.details.responseBody && (
                      <div className="mb-2">
                        <div className="font-medium mb-1">响应体:</div>
                        <pre className="whitespace-pre-wrap break-all">{testResult.details.responseBody}</pre>
                      </div>
                    )}
                    {testResult.details.error && (
                      <div className="mb-2">
                        <div className="font-medium mb-1">错误:</div>
                        <pre className="whitespace-pre-wrap break-all">{testResult.details.error}</pre>
                      </div>
                    )}
                    {testResult.details.headers && Object.keys(testResult.details.headers).length > 0 && (
                      <div>
                        <div className="font-medium mb-1">响应头:</div>
                        <pre className="whitespace-pre-wrap break-all">
                          {Object.entries(testResult.details.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
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
