import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quality, SettingsConfig } from '../../shared/types/api';
import { saveSettings } from './settings';
import { useSettingsAutosave } from './use-settings-autosave';

vi.mock('./settings', () => ({
  saveSettings: vi.fn(),
}));

function createConfig(quality: Quality): SettingsConfig {
  return {
    video: {
      quality,
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
      { initialProps: { config: createConfig('low'), isOpen: false } },
    );

    rerender({ config: createConfig('high'), isOpen: false });
    act(() => vi.advanceTimersByTime(1000));

    expect(saveSettings).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('flushes the latest config when the modal closes', () => {
    const onSave = vi.fn();
    const latestConfig = createConfig('high');
    const { rerender } = renderHook(
      ({ config, isOpen }: { config: SettingsConfig; isOpen: boolean }) =>
        useSettingsAutosave({ config, isOpen, onSave }),
      { initialProps: { config: createConfig('low'), isOpen: true } },
    );

    rerender({ config: latestConfig, isOpen: true });
    rerender({ config: latestConfig, isOpen: false });

    expect(saveSettings).toHaveBeenCalledWith(latestConfig);
    expect(onSave).toHaveBeenCalledWith(latestConfig);
  });
});
