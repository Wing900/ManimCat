import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsConfig } from '../types/api';
import { saveSettings } from './settings';
import { useSettingsAutosave } from './use-settings-autosave';

vi.mock('./settings', () => ({
  saveSettings: vi.fn(),
}));

function createConfig(activeProviderId: string | null): SettingsConfig {
  return {
    api: {
      manimcatApiKey: '',
      activeProviderId,
      providers: [],
    },
    video: {
      quality: 'high',
      frameRate: 30,
    },
  };
}

describe('useSettingsAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores settings changes from a hidden modal', () => {
    const onSave = vi.fn();
    const { rerender } = renderHook(
      ({ config, isOpen }: { config: SettingsConfig; isOpen: boolean }) =>
        useSettingsAutosave({ config, isOpen, onSave }),
      { initialProps: { config: createConfig(null), isOpen: false } },
    );

    rerender({ config: createConfig('provider-2'), isOpen: false });
    act(() => vi.advanceTimersByTime(1000));

    expect(saveSettings).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('flushes the latest config when the modal closes', () => {
    const onSave = vi.fn();
    const latestConfig = createConfig('provider-2');
    const { rerender } = renderHook(
      ({ config, isOpen }: { config: SettingsConfig; isOpen: boolean }) =>
        useSettingsAutosave({ config, isOpen, onSave }),
      { initialProps: { config: createConfig(null), isOpen: true } },
    );

    rerender({ config: latestConfig, isOpen: true });
    rerender({ config: latestConfig, isOpen: false });

    expect(saveSettings).toHaveBeenCalledWith(latestConfig);
    expect(onSave).toHaveBeenCalledWith(latestConfig);
  });
});
