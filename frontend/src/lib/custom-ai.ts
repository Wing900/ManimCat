import { loadSettings } from './settings';

export interface CustomApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export function loadCustomConfig(): CustomApiConfig | null {
  const { api } = loadSettings();
  if (!api.apiUrl || !api.apiKey) {
    return null;
  }

  return {
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    model: api.model || ''
  };
}

