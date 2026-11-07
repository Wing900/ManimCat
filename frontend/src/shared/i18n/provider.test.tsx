import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { I18nProvider } from './provider';
import { useI18n } from './use-i18n';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../infrastructure/storage/settings';

function Probe() {
  const { toggleLocale } = useI18n();
  return (
    <button type="button" onClick={toggleLocale}>
      toggle
    </button>
  );
}

function mount() {
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  return screen.getByRole('button', { name: 'toggle' });
}

beforeEach(() => {
  localStorage.clear();
});

it('switches the narration voice when the interface language flips', () => {
  localStorage.setItem('manimcat_locale', 'zh-CN');
  saveSettings({
    video: {
      ...DEFAULT_SETTINGS.video,
      narration: { enabled: true, voice: 'zh-CN-YunxiNeural', rate: '+0%' },
    },
  });

  fireEvent.click(mount());

  expect(loadSettings().video.narration?.voice).toBe('en-US-JennyNeural');
});

it('repairs a stored mismatch on first load', () => {
  localStorage.setItem('manimcat_locale', 'zh-CN');
  saveSettings({
    video: {
      ...DEFAULT_SETTINGS.video,
      narration: { enabled: true, voice: 'en-US-JennyNeural', rate: '+0%' },
    },
  });

  mount();

  expect(loadSettings().video.narration?.voice).toBe('zh-CN-XiaoxiaoNeural');
});
