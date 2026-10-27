import type { NarrationConfig, SettingsConfig, VideoConfig } from '../../shared/types/api';

const SETTINGS_KEY = 'manimcat_settings';
const SETTINGS_VERSION_KEY = 'manimcat_settings_version';
// v4: connection credentials moved out of this blob into the versioned `manimcat_connection`
// object; only product settings (video, and future appearance) live here.
// v7: the default quality moved from 1080p (high) to 720p (medium); frame rate stays 60.
// v8: narration is opt-in and defaults to off; existing quality/frame rate are preserved.
const SETTINGS_VERSION = '8';

/** Voice options offered by the settings UI. */
export const NARRATION_VOICES = [
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-YunxiNeural',
  'en-US-JennyNeural',
  'en-US-GuyNeural'
] as const;

/** Rate options offered by the settings UI. */
export const NARRATION_RATES = ['-10%', '+0%', '+20%'] as const;

export const DEFAULT_NARRATION: NarrationConfig = {
  enabled: false,
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%'
};

export const DEFAULT_SETTINGS: SettingsConfig = {
  video: {
    quality: 'medium',
    frameRate: 60,
    timeout: 1200,
    narration: { ...DEFAULT_NARRATION }
  }
};

function createDefaultSettings(): SettingsConfig {
  return {
    video: { ...DEFAULT_SETTINGS.video, narration: { ...DEFAULT_NARRATION } }
  };
}

function isNarrationVoice(value: unknown): value is (typeof NARRATION_VOICES)[number] {
  return typeof value === 'string' && (NARRATION_VOICES as readonly string[]).includes(value);
}

function isNarrationRate(value: unknown): value is (typeof NARRATION_RATES)[number] {
  return typeof value === 'string' && (NARRATION_RATES as readonly string[]).includes(value);
}

function sanitizeNarration(raw: unknown): NarrationConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_NARRATION };
  }

  const parsed = raw as Partial<NarrationConfig>;
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_NARRATION.enabled,
    voice: isNarrationVoice(parsed.voice) ? parsed.voice : DEFAULT_NARRATION.voice,
    rate: isNarrationRate(parsed.rate) ? parsed.rate : DEFAULT_NARRATION.rate
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

  return {
    video: {
      quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : DEFAULT_SETTINGS.video.quality,
      frameRate: typeof frameRate === 'number' ? frameRate : DEFAULT_SETTINGS.video.frameRate,
      timeout: typeof timeout === 'number' ? timeout : DEFAULT_SETTINGS.video.timeout,
      narration: sanitizeNarration(parsed.video?.narration)
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
