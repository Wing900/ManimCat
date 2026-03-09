import type { ApiConfig } from '../../types/api';
import type { TestResult } from './types';
import { TestResultBanner } from './test-result-banner';
import { useI18n } from '../../i18n';

interface ApiSettingsTabProps {
  apiConfig: ApiConfig;
  testResult: TestResult;
  onUpdate: (updates: Partial<ApiConfig>) => void;
}

function FloatingInput(props: {
  id: string;
  label: string;
  type: 'text' | 'password';
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const { id, label, type, value, placeholder, onChange } = props;

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary transition-all"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all"
      />
    </div>
  );
}

export function ApiSettingsTab({ apiConfig, testResult, onUpdate }: ApiSettingsTabProps) {
  const { t } = useI18n();

  return (
    <>
      <FloatingInput
        id="manimcatApiKey"
        type="password"
        label={t('settings.api.manimcatKey')}
        value={apiConfig.manimcatApiKey}
        placeholder={t('settings.api.manimcatKeyPlaceholder')}
        onChange={(value) => onUpdate({ manimcatApiKey: value })}
      />
      <FloatingInput
        id="apiUrl"
        type="text"
        label={t('settings.api.url')}
        value={apiConfig.apiUrl}
        placeholder={t('settings.api.urlPlaceholder')}
        onChange={(value) => onUpdate({ apiUrl: value })}
      />
      <FloatingInput
        id="apiKey"
        type="password"
        label={t('settings.api.key')}
        value={apiConfig.apiKey}
        placeholder={t('settings.api.keyPlaceholder')}
        onChange={(value) => onUpdate({ apiKey: value })}
      />
      <FloatingInput
        id="model"
        type="text"
        label={t('settings.api.model')}
        value={apiConfig.model}
        placeholder={t('settings.api.modelPlaceholder')}
        onChange={(value) => onUpdate({ model: value })}
      />
      <TestResultBanner testResult={testResult} />
    </>
  );
}
