import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

const SETTINGS_KEY = 'manimcat_settings';
const SETTINGS_VERSION_KEY = 'manimcat_settings_version';

beforeEach(() => {
  localStorage.clear();
});

describe('video defaults', () => {
  it('defaults to 720p at 60 fps with narration off', () => {
    expect(DEFAULT_SETTINGS.video.quality).toBe('medium');
    expect(DEFAULT_SETTINGS.video.frameRate).toBe(60);
    expect(loadSettings().video).toMatchObject({
      quality: 'medium',
      frameRate: 60,
      narration: { enabled: false, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' },
    });
  });

  it('migrates the old low/15 default to medium/60', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      video: { quality: 'low', frameRate: 15, timeout: 1200, bgm: false },
    }));
    localStorage.setItem(SETTINGS_VERSION_KEY, '5');

    expect(loadSettings().video).toMatchObject({ quality: 'medium', frameRate: 60 });
  });

  it('keeps an explicit non-default combination', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      video: { quality: 'low', frameRate: 30, timeout: 1200, bgm: true },
    }));
    localStorage.setItem(SETTINGS_VERSION_KEY, '5');

    expect(loadSettings().video).toMatchObject({ quality: 'low', frameRate: 30, bgm: true });
  });
});

describe('narration settings', () => {
  it('adds narration off without resetting existing quality, frame rate or BGM', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      video: { quality: 'high', frameRate: 30, timeout: 1800, bgm: true },
    }));
    localStorage.setItem(SETTINGS_VERSION_KEY, '7');

    expect(loadSettings().video).toMatchObject({
      quality: 'high',
      frameRate: 30,
      timeout: 1800,
      bgm: true,
      narration: { enabled: false, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' },
    });
  });

  it('preserves an enabled narration choice across save and load', () => {
    saveSettings({
      video: {
        ...DEFAULT_SETTINGS.video,
        narration: { enabled: true, voice: 'en-US-GuyNeural', rate: '+20%' },
      },
    });

    expect(loadSettings().video.narration).toEqual({
      enabled: true,
      voice: 'en-US-GuyNeural',
      rate: '+20%',
    });
  });

  it('falls back to safe narration defaults for unknown voice or rate', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      video: {
        quality: 'medium',
        frameRate: 60,
        timeout: 1200,
        bgm: false,
        narration: { enabled: true, voice: 'unknown-voice', rate: '999%' },
      },
    }));
    localStorage.setItem(SETTINGS_VERSION_KEY, '8');

    expect(loadSettings().video.narration).toEqual({
      enabled: true,
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: '+0%',
    });
  });
});
