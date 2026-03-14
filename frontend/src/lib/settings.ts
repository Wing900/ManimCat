import type { AIProvider, AIProviderType, SettingsConfig } from '../types/api';

const SETTINGS_KEY = 'manimcat_settings';
const SETTINGS_VERSION_KEY = 'manimcat_settings_version';
const SETTINGS_VERSION = '3';

export const DEFAULT_SETTINGS: SettingsConfig = {
  api: {
    manimcatApiKey: '',
    providers: [],
    activeProviderId: null
  },
  video: {
    quality: 'low',
    frameRate: 15,
    timeout: 1200
  }
};

function getFirstListValue(input: string): string {
  return input
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .find(Boolean) || '';
}

function createProviderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `provider_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeProviderType(type: unknown): AIProviderType {
  return type === 'google' ? 'google' : 'openai';
}

function sanitizeProviders(raw: unknown): AIProvider[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const providers: AIProvider[] = raw
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const provider = item as Partial<AIProvider>;
      const id = typeof provider.id === 'string' && provider.id.trim() ? provider.id.trim() : createProviderId();
      const name =
        typeof provider.name === 'string' && provider.name.trim() ? provider.name.trim() : `Provider ${index + 1}`;

      return {
        id,
        name,
        type: normalizeProviderType(provider.type),
        apiUrl: typeof provider.apiUrl === 'string' ? provider.apiUrl : '',
        apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
        model: typeof provider.model === 'string' ? provider.model : '',
      };
    });

  const seen = new Set<string>();
  return providers.map((provider) => {
    if (!seen.has(provider.id)) {
      seen.add(provider.id);
      return provider;
    }
    const id = createProviderId();
    seen.add(id);
    return { ...provider, id };
  });
}

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
  const providers = sanitizeProviders((parsed.api as unknown as { providers?: unknown } | undefined)?.providers);
  const activeProviderIdRaw = (parsed.api as unknown as { activeProviderId?: unknown } | undefined)?.activeProviderId;
  const activeProviderId =
    typeof activeProviderIdRaw === 'string' && providers.some((provider) => provider.id === activeProviderIdRaw)
      ? activeProviderIdRaw
      : providers.length > 0
        ? providers[0].id
        : null;

  return {
    api: {
      manimcatApiKey:
        typeof (parsed.api as unknown as { manimcatApiKey?: unknown } | undefined)?.manimcatApiKey === 'string'
          ? ((parsed.api as unknown as { manimcatApiKey: string }).manimcatApiKey)
          : DEFAULT_SETTINGS.api.manimcatApiKey,
      providers,
      activeProviderId
    },
    video: {
      quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : DEFAULT_SETTINGS.video.quality,
      frameRate: typeof frameRate === 'number' ? frameRate : DEFAULT_SETTINGS.video.frameRate,
      timeout: typeof timeout === 'number' ? timeout : DEFAULT_SETTINGS.video.timeout
    }
  };
}

function splitListInput(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function valueByIndex(values: string[], index: number): string {
  if (values.length === 0) {
    return '';
  }
  if (values.length === 1) {
    return values[0];
  }
  return values[index] || '';
}

function guessProviderType(apiUrl: string): AIProviderType {
  const normalized = apiUrl.toLowerCase();
  if (normalized.includes('generativelanguage.googleapis.com') || normalized.includes('/v1beta/openai')) {
    return 'google';
  }
  return 'openai';
}

function migrateLegacyApiToProviders(legacy: { apiUrl?: string; apiKey?: string; model?: string }): AIProvider[] {
  const urls = splitListInput(legacy.apiUrl);
  const keys = splitListInput(legacy.apiKey);
  const models = splitListInput(legacy.model);
  const maxCount = Math.max(urls.length, keys.length, models.length, 0);

  if (maxCount === 0) {
    return [];
  }

  const providers: AIProvider[] = [];
  for (let i = 0; i < maxCount; i += 1) {
    const apiUrl = valueByIndex(urls, i);
    const apiKey = valueByIndex(keys, i);
    const model = valueByIndex(models, i);

    if (!apiUrl && !apiKey && !model) {
      continue;
    }

    providers.push({
      id: createProviderId(),
      name: maxCount > 1 ? `Provider ${i + 1}` : 'Default Provider',
      type: guessProviderType(apiUrl),
      apiUrl,
      apiKey,
      model,
    });
  }

  return providers;
}

function migrateSettings(raw: unknown, fromVersion: string | null): SettingsConfig {
  if (!raw || typeof raw !== 'object') {
    return createDefaultSettings();
  }

  const parsed = raw as Record<string, unknown>;
  const api = (parsed.api && typeof parsed.api === 'object' ? (parsed.api as Record<string, unknown>) : null);
  const isLegacyApiShape = Boolean(api && typeof api.apiUrl === 'string' && !('providers' in api));

  const normalizedToV3: unknown = isLegacyApiShape
    ? {
        ...parsed,
        api: {
          manimcatApiKey: typeof api?.manimcatApiKey === 'string' ? api.manimcatApiKey : '',
          providers: migrateLegacyApiToProviders({
            apiUrl: typeof api?.apiUrl === 'string' ? api.apiUrl : '',
            apiKey: typeof api?.apiKey === 'string' ? api.apiKey : '',
            model: typeof api?.model === 'string' ? api.model : '',
          }),
          activeProviderId: null,
        },
      }
    : raw;

  const sanitized = sanitizeSettings(normalizedToV3);

  // v1 -> v2: 旧默认值为 600 秒，升级为 1200 秒作为新默认层级
  if ((fromVersion === null || fromVersion === '1') && sanitized.video.timeout === 600) {
    return {
      ...sanitized,
      video: {
        ...sanitized.video,
        timeout: 1200
      }
    };
  }

  return sanitized;
}

export function loadSettings(): SettingsConfig {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (!saved) {
    return createDefaultSettings();
  }

  const version = localStorage.getItem(SETTINGS_VERSION_KEY);
  if (version !== SETTINGS_VERSION) {
    try {
      const migrated = migrateSettings(JSON.parse(saved), version);
      saveSettings(migrated);
      return migrated;
    } catch {
      return createDefaultSettings();
    }
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

  const defaultManimcatApiKey = getFirstListValue(sanitized.api.manimcatApiKey);
  if (defaultManimcatApiKey) {
    localStorage.setItem('manimcat_api_key', defaultManimcatApiKey);
  } else {
    localStorage.removeItem('manimcat_api_key');
  }
}
