import { useEffect, useMemo, useRef, useState } from 'react';
import type { AIProvider, AIProviderType, CustomApiConfig, SettingsConfig } from '../types/api';
import { loadSettings, saveSettings } from '../lib/settings';
import { GOOGLE_OPENAI_COMPAT_URL, OPENAI_DEFAULT_URL } from '../lib/ai-providers';
import { FloatingInput } from './settings-modal/FloatingInput';
import type { TestResult } from './settings-modal/types';
import { TestResultBanner } from './settings-modal/test-result-banner';
import { useI18n } from '../i18n';

interface ProviderConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: SettingsConfig) => void;
}

type ProviderMetadataJson = {
  url?: string;
  apiUrl?: string;
  key?: string;
  apiKey?: string;
  model?: string;
};

function createProviderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `provider_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toProviderMetadataJson(provider: AIProvider): ProviderMetadataJson {
  return {
    url: provider.apiUrl || '',
    key: provider.apiKey || '',
  };
}

function parseProviderMetadataJson(text: string): { ok: true; value: ProviderMetadataJson } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Invalid JSON object' };
    }
    return { ok: true, value: parsed as ProviderMetadataJson };
  } catch {
    return { ok: false, error: 'Invalid JSON format' };
  }
}

function resolveCustomApiConfig(provider: AIProvider): CustomApiConfig | null {
  const apiUrl = provider.apiUrl.trim();
  const apiKey = provider.apiKey.trim();
  const model = provider.model.trim();
  const hasAny = Boolean(apiUrl || apiKey || model);
  if (!hasAny) {
    return null;
  }
  if (!apiUrl || !apiKey) {
    return null;
  }
  return { apiUrl, apiKey, model };
}

function normalizeProviderType(type: unknown): AIProviderType {
  return type === 'google' ? 'google' : 'openai';
}

export function ProviderConfigModal({ isOpen, onClose, onSave }: ProviderConfigModalProps) {
  const { t } = useI18n();
  const [config, setConfig] = useState<SettingsConfig>(() => loadSettings());
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [metadataText, setMetadataText] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [modelsByProviderId, setModelsByProviderId] = useState<Record<string, string[]>>({});
  const [fetchingModels, setFetchingModels] = useState(false);

  const autoSaveTimerRef = useRef<number | null>(null);
  const metadataTimerRef = useRef<number | null>(null);
  const modelFetchTimerRef = useRef<number | null>(null);
  const metadataTouchedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      if (metadataTimerRef.current) {
        clearTimeout(metadataTimerRef.current);
        metadataTimerRef.current = null;
      }
      if (modelFetchTimerRef.current) {
        clearTimeout(modelFetchTimerRef.current);
        modelFetchTimerRef.current = null;
      }
      return;
    }
    const loaded = loadSettings();
    setConfig(loaded);
    setSelectedProviderId(loaded.api.activeProviderId ?? loaded.api.providers[0]?.id ?? null);
    setTestResult({ status: 'idle', message: '' });
    setModelsByProviderId({});
    setFetchingModels(false);
    setMetadataError(null);
    setDeleteDialogOpen(false);
    setTestDialogOpen(false);
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

  const providers = config.api.providers;

  const selectedProvider = useMemo(() => {
    if (!selectedProviderId) {
      return null;
    }
    return providers.find((provider) => provider.id === selectedProviderId) || null;
  }, [providers, selectedProviderId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (!selectedProvider) {
      setMetadataText('');
      return;
    }
    setMetadataText(JSON.stringify(toProviderMetadataJson(selectedProvider), null, 2));
    metadataTouchedRef.current = false;
    setMetadataError(null);
    setDeleteDialogOpen(false);
    setTestDialogOpen(false);
  }, [isOpen, selectedProvider?.id]);

  useEffect(() => {
    if (!isOpen || !selectedProvider) {
      return;
    }
    if (metadataTouchedRef.current) {
      return;
    }
    setMetadataText(JSON.stringify(toProviderMetadataJson(selectedProvider), null, 2));
  }, [isOpen, selectedProvider?.id, selectedProvider?.apiUrl, selectedProvider?.apiKey, selectedProvider?.model]);

  const setActiveProvider = (id: string) => {
    setConfig((prev) => ({ ...prev, api: { ...prev.api, activeProviderId: id } }));
    setSelectedProviderId(id);
    setDeleteDialogOpen(false);
  };

  const addProvider = () => {
    const id = createProviderId();
    const provider: AIProvider = {
      id,
      name: t('providers.newName'),
      type: 'openai',
      apiUrl: OPENAI_DEFAULT_URL,
      apiKey: '',
      model: '',
    };
    setConfig((prev) => ({ ...prev, api: { ...prev.api, providers: [...prev.api.providers, provider], activeProviderId: id } }));
    setSelectedProviderId(id);
    setDeleteDialogOpen(false);
  };

  const deleteSelectedProvider = () => {
    if (!selectedProvider) {
      return;
    }
    const nextProviders = providers.filter((provider) => provider.id !== selectedProvider.id);
    const nextActiveProviderId =
      config.api.activeProviderId === selectedProvider.id
        ? (nextProviders[0]?.id ?? null)
        : config.api.activeProviderId;

    setConfig((prev) => ({ ...prev, api: { ...prev.api, providers: nextProviders, activeProviderId: nextActiveProviderId } }));
    setSelectedProviderId(nextActiveProviderId);
    setModelsByProviderId((prev) => {
      const next = { ...prev };
      delete next[selectedProvider.id];
      return next;
    });
    setDeleteDialogOpen(false);
  };

  const updateSelectedProvider = (updates: Partial<AIProvider>) => {
    if (!selectedProvider) {
      return;
    }
    setConfig((prev) => ({
      ...prev,
      api: {
        ...prev.api,
        providers: prev.api.providers.map((provider) => (provider.id === selectedProvider.id ? { ...provider, ...updates } : provider)),
      },
    }));
  };

  const applyMetadataToProvider = (value: ProviderMetadataJson) => {
    if (!selectedProvider) {
      return;
    }
    const apiUrl = (value.apiUrl ?? value.url ?? '').toString();
    const apiKey = (value.apiKey ?? value.key ?? '').toString();
    const model = typeof value.model === 'string' ? value.model : '';
    updateSelectedProvider({ apiUrl, apiKey, ...(model.trim() ? { model } : {}) });
  };

  const onMetadataTextChange = (text: string) => {
    setMetadataText(text);
    metadataTouchedRef.current = true;

    if (metadataTimerRef.current) {
      clearTimeout(metadataTimerRef.current);
    }

    metadataTimerRef.current = window.setTimeout(() => {
      const parsed = parseProviderMetadataJson(text);
      if (!parsed.ok) {
        setMetadataError(t('providers.metadata.invalidJson'));
        return;
      }
      setMetadataError(null);
      applyMetadataToProvider(parsed.value);
    }, 400);
  };

  const fetchModelsForSelectedProvider = async (provider: AIProvider) => {
    const manimcatKey = config.api.manimcatApiKey.trim();
    if (!manimcatKey) {
      return;
    }

    const customApiConfig = resolveCustomApiConfig(provider);
    if (!customApiConfig) {
      return;
    }

    setFetchingModels(true);
    try {
      const response = await fetch('/api/ai/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${manimcatKey}`,
        },
        body: JSON.stringify({ customApiConfig }),
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { models?: unknown };
      const models = Array.isArray(data.models) ? data.models.filter((item) => typeof item === 'string') : [];
      setModelsByProviderId((prev) => ({ ...prev, [provider.id]: models }));
    } finally {
      setFetchingModels(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !selectedProvider) {
      return;
    }

    if (modelFetchTimerRef.current) {
      clearTimeout(modelFetchTimerRef.current);
    }

    modelFetchTimerRef.current = window.setTimeout(() => {
      void fetchModelsForSelectedProvider(selectedProvider);
    }, 500);

    return () => {
      if (modelFetchTimerRef.current) {
        clearTimeout(modelFetchTimerRef.current);
        modelFetchTimerRef.current = null;
      }
    };
  }, [isOpen, selectedProvider?.id, selectedProvider?.apiUrl, selectedProvider?.apiKey]);

  const handleTest = async () => {
    setTestDialogOpen(true);

    if (!selectedProvider) {
      setTestResult({ status: 'error', message: t('providers.empty') });
      return;
    }
    const manimcatKey = config.api.manimcatApiKey.trim();
    if (!manimcatKey) {
      setTestResult({ status: 'error', message: t('settings.test.needManimcatKey') });
      return;
    }

    const customApiConfig = resolveCustomApiConfig(selectedProvider);
    if (!customApiConfig) {
      setTestResult({ status: 'error', message: t('settings.test.needUrlAndKey') });
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
        body: JSON.stringify({ customApiConfig }),
      });

      const duration = Math.round(performance.now() - startTime);
      if (response.ok) {
        setTestResult({
          status: 'success',
          message: t('settings.test.success', { duration }),
          details: { duration },
        });
        return;
      }

      setTestResult({
        status: 'error',
        message: `HTTP ${response.status}: ${response.statusText}`,
        details: { statusCode: response.status, statusText: response.statusText, duration },
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

  if (!isOpen) {
    return null;
  }

  const activeProviderId = config.api.activeProviderId;
  const modelSuggestions = selectedProvider ? (modelsByProviderId[selectedProvider.id] || []) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          setDeleteDialogOpen(false);
          setTestDialogOpen(false);
          onClose();
        }}
      />
      <div className="relative w-full max-w-3xl lg:max-w-4xl max-h-[86vh] flex flex-col overflow-hidden bg-bg-secondary rounded-2xl shadow-xl border border-bg-tertiary/30">
        <div className="h-16 bg-bg-secondary/50 border-b border-bg-tertiary/30 flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-base text-text-primary font-medium">{t('providers.title')}</span>
          </div>
          <button
            onClick={() => {
              setDeleteDialogOpen(false);
              setTestDialogOpen(false);
              onClose();
            }}
            className="p-2 text-text-secondary/70 hover:text-text-primary hover:bg-bg-tertiary/50 rounded-lg transition-colors"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {providers.map((provider) => {
              const isActive = provider.id === activeProviderId;
              const base =
                'px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-colors cursor-pointer flex items-center gap-2 border';
              const cls = isActive
                ? `${base} bg-accent/75 text-bg-primary border-accent/25 shadow-sm shadow-black/10 hover:bg-accent/85 dark:bg-bg-tertiary/70 dark:text-text-primary dark:border-bg-tertiary/50 dark:hover:bg-bg-tertiary/85 dark:shadow-black/25`
                : `${base} bg-bg-secondary/20 text-text-secondary hover:text-text-primary hover:bg-bg-secondary/35 border-bg-tertiary/20`;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setActiveProvider(provider.id)}
                  className={cls}
                >
                  {isActive ? (
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse ring-2 ring-green-400/20" />
                  ) : null}
                  <span>{provider.name || t('providers.unnamed')}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={addProvider}
              className="px-3 py-2 rounded-xl text-sm whitespace-nowrap cursor-pointer text-accent border border-dashed border-accent/70 hover:border-accent hover:bg-bg-secondary/25 transition-colors"
              title={t('providers.add')}
            >
              +
            </button>
          </div>

          <div className="h-px bg-bg-tertiary/30" />

          <div className="rounded-2xl bg-bg-secondary/25 border border-bg-tertiary/30 p-5 space-y-5">
            {selectedProvider ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FloatingInput
                    id="providerNameCompact"
                    type="text"
                    label={t('providers.name')}
                    value={selectedProvider.name}
                    placeholder={t('providers.namePlaceholder')}
                    onChange={(value) => updateSelectedProvider({ name: value })}
                    inputClassName="text-base py-5"
                  />

                  <FloatingInput
                    id="providerModelCompact"
                    type="text"
                    label={t('providers.model')}
                    value={selectedProvider.model}
                    placeholder={fetchingModels ? t('providers.modelLoading') : t('providers.modelPlaceholder')}
                    onChange={(value) => updateSelectedProvider({ model: value })}
                    suggestions={modelSuggestions}
                    inputClassName="text-base py-5"
                  />
                </div>

                <div className="h-px bg-bg-tertiary/25" />

                <div>
                  <div className="text-[11px] font-medium text-text-secondary uppercase tracking-[0.12em] px-1">
                    {t('providers.type')}
                  </div>
                  <div className="flex gap-2 mt-2">
                    {(['openai', 'google'] as const).map((type) => {
                      const selected = selectedProvider.type === type;
                      const cls = selected
                        ? 'text-sm px-4 py-2 rounded-lg bg-accent/15 text-accent border border-accent/20'
                        : 'text-sm px-4 py-2 rounded-lg bg-bg-secondary/20 text-text-secondary border border-bg-tertiary/30 hover:text-text-primary hover:bg-bg-secondary/35';
                      const label = type === 'openai' ? t('providers.typeOpenAI') : t('providers.typeGoogle');
                    return (
                      <button
                        key={type}
                        type="button"
                        className={cls}
                        onClick={() => {
                          const nextType = normalizeProviderType(type);
                          const shouldAutofillUrl =
                            !selectedProvider.apiUrl.trim() || !selectedProvider.apiKey.trim();
                          const updates: Partial<AIProvider> = { type: nextType };
                          if (nextType === 'google' && shouldAutofillUrl) {
                            updates.apiUrl = GOOGLE_OPENAI_COMPAT_URL;
                          }
                          if (nextType === 'openai' && shouldAutofillUrl) {
                            updates.apiUrl = OPENAI_DEFAULT_URL;
                          }
                          updateSelectedProvider(updates);
                        }}
                      >
                        {label}
                      </button>
                      );
                    })}
                  </div>
                </div>

                <div className="h-px bg-bg-tertiary/25" />

                <div className="bg-bg-secondary/40 rounded-xl p-4 border border-bg-tertiary/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-text-primary/90">{t('providers.metadataTitle')}</span>
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={testResult.status === 'testing'}
                      className="text-sm font-medium text-accent hover:text-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('settings.test')}
                    </button>
                  </div>

                  <textarea
                    value={metadataText}
                    onChange={(e) => onMetadataTextChange(e.target.value)}
                    spellCheck={false}
                    className="w-full h-36 bg-bg-secondary/30 border border-bg-tertiary/30 rounded-lg font-mono text-[12px] text-text-secondary/80 px-4 py-3 focus:outline-none focus:border-accent/30 focus:ring-1 focus:ring-accent/20 transition-colors"
                    placeholder={t('providers.metadataPlaceholder')}
                  />

                  {metadataError ? (
                    <div className="mt-2 text-xs text-red-600 dark:text-red-400">{metadataError}</div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="text-sm text-text-secondary">{t('providers.empty')}</div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-bg-tertiary/30 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={!selectedProvider}
            className="text-base text-red-600 dark:text-red-400 hover:text-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('providers.delete')}
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setDeleteDialogOpen(false);
                setTestDialogOpen(false);
                onClose();
              }}
              className="px-6 py-3 text-sm font-medium text-text-secondary hover:text-text-primary bg-bg-secondary/40 hover:bg-bg-secondary/60 rounded-2xl transition-all focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>

      {deleteDialogOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteDialogOpen(false)} />
          <div className="relative bg-bg-secondary rounded-2xl p-6 max-w-sm w-full shadow-xl border border-bg-tertiary/30">
            <h3 className="text-base font-medium text-text-primary">{t('providers.delete')}</h3>
            <p className="text-sm text-text-secondary/80 mt-2 leading-relaxed">{t('providers.deleteConfirm')}</p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary bg-bg-secondary/40 hover:bg-bg-secondary/60 rounded-xl transition-all"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={deleteSelectedProvider}
                className="flex-1 px-4 py-2.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {testDialogOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setTestDialogOpen(false)} />
          <div className="relative bg-bg-secondary rounded-2xl p-6 max-w-sm w-full shadow-xl border border-bg-tertiary/30">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium text-text-primary">{t('settings.test')}</h3>
              <button
                type="button"
                onClick={() => setTestDialogOpen(false)}
                className="p-2 text-text-secondary/70 hover:text-text-primary hover:bg-bg-tertiary/50 rounded-lg transition-colors"
                aria-label={t('common.close')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4">
              <TestResultBanner testResult={testResult} />
            </div>

            {testResult.details ? (
              <details className="mt-4">
                <summary className="text-xs text-text-secondary/70 cursor-pointer select-none">
                  Details
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto text-[11px] rounded-xl bg-bg-secondary/30 border border-bg-tertiary/30 p-3 text-text-secondary/80">
{JSON.stringify(testResult.details, null, 2)}
                </pre>
              </details>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setTestDialogOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary bg-bg-secondary/40 hover:bg-bg-secondary/60 rounded-xl transition-all"
              >
                {t('common.close')}
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={testResult.status === 'testing'}
                className="flex-1 px-4 py-2.5 text-sm text-bg-primary bg-accent hover:bg-accent-hover rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('settings.test')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
