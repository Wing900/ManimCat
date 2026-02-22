import type { ApiConfig } from '../../types/api';
import type { TestResult } from './types';
import { TestResultBanner } from './test-result-banner';

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
  return (
    <>
      <FloatingInput
        id="manimcatApiKey"
        type="password"
        label="ManimCat API 密钥"
        value={apiConfig.manimcatApiKey}
        placeholder="留空则跳过认证"
        onChange={(value) => onUpdate({ manimcatApiKey: value })}
      />
      <FloatingInput
        id="apiUrl"
        type="text"
        label="API 地址"
        value={apiConfig.apiUrl}
        placeholder="https://api.xiaomimimo.com/v1"
        onChange={(value) => onUpdate({ apiUrl: value })}
      />
      <FloatingInput
        id="apiKey"
        type="password"
        label="API 密钥"
        value={apiConfig.apiKey}
        placeholder="sk-..."
        onChange={(value) => onUpdate({ apiKey: value })}
      />
      <FloatingInput
        id="model"
        type="text"
        label="模型名称"
        value={apiConfig.model}
        placeholder="mimo-v2-flash"
        onChange={(value) => onUpdate({ model: value })}
      />
      <TestResultBanner testResult={testResult} />
    </>
  );
}
