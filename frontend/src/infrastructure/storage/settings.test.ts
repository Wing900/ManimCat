import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from './settings';

const SETTINGS_KEY = 'manimcat_settings';
const SETTINGS_VERSION_KEY = 'manimcat_settings_version';

beforeEach(() => {
  localStorage.clear();
});

describe('video defaults', () => {
  it('defaults to 1080p at 60 fps', () => {
    expect(DEFAULT_SETTINGS.video.quality).toBe('high');
    expect(DEFAULT_SETTINGS.video.frameRate).toBe(60);
    expect(loadSettings().video).toMatchObject({ quality: 'high', frameRate: 60 });
  });

  it('migrates the old low/15 default to high/60', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      video: { quality: 'low', frameRate: 15, timeout: 1200, bgm: false },
    }));
    localStorage.setItem(SETTINGS_VERSION_KEY, '5');

    expect(loadSettings().video).toMatchObject({ quality: 'high', frameRate: 60 });
  });

  it('keeps an explicit non-default combination', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      video: { quality: 'low', frameRate: 30, timeout: 1200, bgm: false },
    }));
    localStorage.setItem(SETTINGS_VERSION_KEY, '5');

    expect(loadSettings().video).toMatchObject({ quality: 'low', frameRate: 30 });
  });
});
