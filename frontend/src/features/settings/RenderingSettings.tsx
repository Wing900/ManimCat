import { useCallback, useEffect, useRef, useState } from 'react';
import { detectBrowserRenderSupport, resetBrowserRenderSupportCache } from '../browser-rendering';
import { useI18n, type TranslationKey } from '../../shared/i18n';
import type { RenderTarget } from '../../shared/types/api';
import { RenderingUnavailableDialog } from './RenderingUnavailableDialog';

interface RenderingSettingsProps {
  target: RenderTarget;
  onChange: (target: RenderTarget) => void;
}

/** A single preference switch; capability checks run only when enabling it. */
export function RenderingSettings({ target, onChange }: RenderingSettingsProps) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<TranslationKey | null>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);
  const enabled = target === 'browser';

  useEffect(() => () => {
    // Ignore an adapter request that finishes after leaving this settings page.
    requestRef.current += 1;
    pendingRef.current = false;
  }, []);

  const closeFailure = useCallback(() => setFailure(null), []);

  const toggle = async () => {
    if (pendingRef.current) return;
    if (enabled) {
      onChange('cloud');
      return;
    }
    const request = ++requestRef.current;
    pendingRef.current = true;
    setChecking(true);
    setFailure(null);
    resetBrowserRenderSupportCache();
    try {
      // Device detection must not depend on the site's renderer URL configuration.
      const capability = await detectBrowserRenderSupport();
      if (request !== requestRef.current) return;
      if (capability.supported) {
        onChange('browser');
      } else {
        switch (capability.reason) {
          case 'no-navigator-gpu':
          case 'no-adapter':
          case 'missing-feature':
            setFailure('settings.rendering.noGpu');
            break;
          case 'insecure-context':
            setFailure('settings.rendering.insecure');
            break;
          case 'adapter-timeout':
            setFailure('settings.rendering.checkTimedOut');
            break;
          default:
            setFailure('settings.rendering.checkFailed');
        }
      }
    } catch {
      if (request === requestRef.current) setFailure('settings.rendering.checkFailed');
    } finally {
      if (request === requestRef.current) {
        pendingRef.current = false;
        setChecking(false);
      }
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-6 rounded-xl bg-bg-secondary/40 px-4 py-3">
        <div className="min-w-0">
          <span id="settings-rendering-label" className="block text-sm text-text-primary">
            {t('settings.rendering.browser')}
          </span>
          <p id="settings-rendering-description" className="mt-1 text-xs leading-relaxed text-text-secondary/65">
            {t('settings.rendering.description')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="settings-rendering-label"
          aria-describedby="settings-rendering-description"
          aria-busy={checking}
          disabled={checking}
          onClick={() => void toggle()}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 ease-ui focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-wait disabled:opacity-50 ${
            enabled ? 'bg-ink/70' : 'bg-text-secondary/25'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring ${
              enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {failure && <RenderingUnavailableDialog message={failure} onClose={closeFailure} />}
    </>
  );
}
