export interface CustomApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export function loadCustomConfig(): CustomApiConfig | null {
  const saved = localStorage.getItem('manimcat_settings');
  if (!saved) {
    return null;
  }

  try {
    const parsed = JSON.parse(saved);
    if (parsed.api && parsed.api.apiUrl && parsed.api.apiKey) {
      return {
        apiUrl: parsed.api.apiUrl,
        apiKey: parsed.api.apiKey,
        model: parsed.api.model || ''
      };
    }
  } catch {
    return null;
  }

  return null;
}
