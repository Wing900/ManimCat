import type { SettingsConfig } from '../types/api';

const SETTINGS_KEY = 'manimcat_settings';
const SETTINGS_VERSION_KEY = 'manimcat_settings_version';
const SETTINGS_VERSION = '1';

export const DEFAULT_SETTINGS: SettingsConfig = {
  api: {
    apiUrl: '',
    apiKey: '',
    model: '',
    manimcatApiKey: ''
  },
  video: {
    quality: 'low',
    frameRate: 15,
    timeout: 120
  }
};

function createDefaultSettings(): SettingsConfig {
  return {
    api: { ...DEFAULT_SETTINGS.api },
    video: { ...DEFAULT_SETTINGS.video }
  };
}

function sanitizeSettings(raw: unknown): SettingsConfig {
  if (!raw || typeof raw !== 'object') {
    return createDefaultSettings();
  }

  const parsed = raw as Partial<SettingsConfig>;
  const quality = parsed.video?.quality;
  const frameRate = parsed.video?.frameRate;
  const timeout = parsed.video?.timeout;

  return {
    api: {
      apiUrl: typeof parsed.api?.apiUrl === 'string' ? parsed.api.apiUrl : DEFAULT_SETTINGS.api.apiUrl,
      apiKey: typeof parsed.api?.apiKey === 'string' ? parsed.api.apiKey : DEFAULT_SETTINGS.api.apiKey,
      model: typeof parsed.api?.model === 'string' ? parsed.api.model : DEFAULT_SETTINGS.api.model,
      manimcatApiKey: typeof parsed.api?.manimcatApiKey === 'string' ? parsed.api.manimcatApiKey : DEFAULT_SETTINGS.api.manimcatApiKey
    },
    video: {
      quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : DEFAULT_SETTINGS.video.quality,
      frameRate: typeof frameRate === 'number' ? frameRate : DEFAULT_SETTINGS.video.frameRate,
      timeout: typeof timeout === 'number' ? timeout : DEFAULT_SETTINGS.video.timeout
    }
  };
}

export function loadSettings(): SettingsConfig {
  const version = localStorage.getItem(SETTINGS_VERSION_KEY);
  if (version !== SETTINGS_VERSION) {
    return createDefaultSettings();
  }

  const saved = localStorage.getItem(SETTINGS_KEY);
  if (!saved) {
    return createDefaultSettings();
  }

  try {
    return sanitizeSettings(JSON.parse(saved));
  } catch {
    return createDefaultSettings();
  }
}

export function saveSettings(settings: SettingsConfig): void {
  const sanitized = sanitizeSettings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitized));
  localStorage.setItem(SETTINGS_VERSION_KEY, SETTINGS_VERSION);

  if (sanitized.api.manimcatApiKey) {
    localStorage.setItem('manimcat_api_key', sanitized.api.manimcatApiKey);
  } else {
    localStorage.removeItem('manimcat_api_key');
  }
}

