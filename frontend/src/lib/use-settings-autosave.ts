import { useEffect, useRef } from 'react';
import type { SettingsConfig } from '../types/api';
import { saveSettings } from './settings';

interface UseSettingsAutosaveParams {
  config: SettingsConfig;
  isOpen: boolean;
  onSave: (config: SettingsConfig) => void;
  delayMs?: number;
}

function persistSettings(config: SettingsConfig, onSave: (config: SettingsConfig) => void): void {
  saveSettings(config);
  onSave(config);
}

/**
 * Persist modal-owned settings while the modal is open.
 *
 * The latest values live in refs so an inline `onSave` callback from the
 * parent cannot restart the timer with a stale hidden modal snapshot.
 */
export function useSettingsAutosave({ config, isOpen, onSave, delayMs = 500 }: UseSettingsAutosaveParams): void {
  const configRef = useRef(config);
  const onSaveRef = useRef(onSave);
  const wasOpenRef = useRef(isOpen);

  useEffect(() => {
    configRef.current = config;
    onSaveRef.current = onSave;
  }, [config, onSave]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!isOpen) {
      if (wasOpen) {
        persistSettings(configRef.current, onSaveRef.current);
      }
      return;
    }

    const timer = window.setTimeout(() => {
      persistSettings(configRef.current, onSaveRef.current);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [config, delayMs, isOpen]);
}
