import type { AIProvider, ApiConfig, CustomApiConfig } from '../types/api';

export const GOOGLE_OPENAI_COMPAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
export const OPENAI_DEFAULT_URL = 'https://api.openai.com/v1';

export function getActiveProvider(apiConfig: ApiConfig): AIProvider | null {
  const id = apiConfig.activeProviderId;
  if (!id) {
    return null;
  }
  return apiConfig.providers.find((provider) => provider.id === id) || null;
}

export function providerToCustomApiConfig(provider: AIProvider | null): CustomApiConfig | undefined {
  if (!provider) {
    return undefined;
  }

  const apiUrl = provider.apiUrl.trim();
  const apiKey = provider.apiKey.trim();
  const model = provider.model.trim();

  const hasAnyCustomField = Boolean(apiUrl || apiKey || model);
  if (!hasAnyCustomField) {
    return undefined;
  }

  if (!apiUrl || !apiKey) {
    return undefined;
  }

  return { apiUrl, apiKey, model };
}

export function formatProviderLabel(provider: AIProvider): string {
  const typeLabel = provider.type === 'google' ? 'Google' : 'OpenAI';
  const name = provider.name?.trim() || 'Provider';
  return `${name} (${typeLabel})`;
}
