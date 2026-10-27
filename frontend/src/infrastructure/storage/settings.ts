import type { SettingsConfig, VideoConfig } from '../../shared/types/api';

const SETTINGS_KEY = 'manimcat_settings';
const SETTINGS_VERSION_KEY = 'manimcat_settings_version';
// v4: connection credentials moved out of this blob into the versioned `manimcat_connection`
// object; only product settings (video, and future appearance) live here.
// v5: background music became opt-in; videos are silent unless the user enables it.
// v7: the default quality moved from 1080p (high) to 720p (medium); frame rate stays 60.
const SETTINGS_VERSION = '7';

export const DEFAULT_SETTINGS: SettingsConfig = {
  video: {
    quality: 'medium',
    frameRate: 60,
    timeout: 1200,
    bgm: false
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

function isOlderThan(fromVersion: string | null, target: number): boolean {
  if (fromVersion === null) return true;
  const version = Number(fromVersion);
  return Number.isFinite(version) && version < target;
}

function migrateSettings(raw: unknown, fromVersion: string | null): SettingsConfig {
  let sanitized = sanitizeSettings(raw);

  // v1 -> v2: 旧默认值为 600 秒，升级为 1200 秒作为新默认层级
  if (isOlderThan(fromVersion, 2) && sanitized.video.timeout === 600) {
    sanitized = {
      ...sanitized,
      video: {
        ...sanitized.video,
        timeout: 1200
      }
    };
  }

  // v4 -> v5: 背景音乐改为显式开启，旧版本保存的默认开启值不再沿用。
  if (isOlderThan(fromVersion, 5) && sanitized.video.bgm) {
    sanitized = {
      ...sanitized,
      video: {
        ...sanitized.video,
        bgm: false
      }
    };
  }

  // v5 -> v6: 旧默认 480p/15fps 升级为 1080p/60fps；用户手动选择的其他组合保留。
  if (isOlderThan(fromVersion, 6) && sanitized.video.quality === 'low' && sanitized.video.frameRate === 15) {
    sanitized = {
      ...sanitized,
      video: {
        ...sanitized.video,
        quality: 'high',
        frameRate: 60
      }
    };
  }

  // v6 -> v7: 旧默认 1080p 改为 720p/60fps；用户之后在 v7 手动选择的 high 不再被改写。
  if (isOlderThan(fromVersion, 7) && sanitized.video.quality === 'high') {
    sanitized = {
      ...sanitized,
      video: {
        ...sanitized.video,
        quality: 'medium'
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
