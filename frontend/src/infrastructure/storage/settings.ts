import type { SettingsConfig, VideoConfig } from '../../shared/types/api';

const SETTINGS_KEY = 'manimcat_settings';
const SETTINGS_VERSION_KEY = 'manimcat_settings_version';
// v4: connection credentials moved out of this blob into the versioned `manimcat_connection`
// object; only product settings (video, and future appearance) live here.
const SETTINGS_VERSION = '4';

export const DEFAULT_SETTINGS: SettingsConfig = {
  video: {
    quality: 'low',
    frameRate: 15,
    timeout: 1200,
    bgm: true
  }
};

function createDefaultSettings(): SettingsConfig {
  return {
    video: { ...DEFAULT_SETTINGS.video }
  };
}

function sanitizeSettings(raw: unknown): SettingsConfig {
  if (!raw || typeof raw !== 'object') {
    return createDefaultSettings();
  }

  const parsed = raw as { video?: Partial<VideoConfig> };
  const quality = parsed.video?.quality;
  const frameRate = parsed.video?.frameRate;
  const timeout = parsed.video?.timeout;
  const bgm = parsed.video?.bgm;

  return {
    video: {
      quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : DEFAULT_SETTINGS.video.quality,
      frameRate: typeof frameRate === 'number' ? frameRate : DEFAULT_SETTINGS.video.frameRate,
      timeout: typeof timeout === 'number' ? timeout : DEFAULT_SETTINGS.video.timeout,
      bgm: typeof bgm === 'boolean' ? bgm : DEFAULT_SETTINGS.video.bgm
    }
  };
}

function migrateSettings(raw: unknown, fromVersion: string | null): SettingsConfig {
  const sanitized = sanitizeSettings(raw);

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
}
