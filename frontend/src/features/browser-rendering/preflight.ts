import { detectBrowserRenderSupport } from './capabilities';
import { resolveBrowserRendererConfig } from './renderer-config';

export type BrowserRenderPreflightFailure =
  | {
      ok: false;
      stage: 'config';
      reason: string;
      detail: string;
    }
  | {
      ok: false;
      stage: 'capability';
      reason: string;
      detail: string;
      missingFeatures?: string[];
    };

export type BrowserRenderPreflightResult =
  | { ok: true; rendererUrl: string }
  | BrowserRenderPreflightFailure;

/**
 * Pure preflight for a browser-targeted Workflow video. Run before any expensive
 * generation/planning request so an unavailable renderer never consumes AI budget and
 * never quietly becomes a cloud job.
 */
export async function preflightBrowserRender(): Promise<BrowserRenderPreflightResult> {
  const config = resolveBrowserRendererConfig();
  if (!config.available) {
    return {
      ok: false,
      stage: 'config',
      reason: config.reason,
      detail: config.detail,
    };
  }

  const capability = await detectBrowserRenderSupport();
  if (!capability.supported) {
    return {
      ok: false,
      stage: 'capability',
      reason: capability.reason,
      detail: capability.detail,
      ...(capability.missingFeatures ? { missingFeatures: capability.missingFeatures } : {}),
    };
  }

  return { ok: true, rendererUrl: config.url };
}
