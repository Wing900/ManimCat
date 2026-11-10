import { validateRendererUrl, type RendererUrlProblem } from './renderer-url';

export type BrowserRendererConfigFailure =
  | { available: false; reason: 'missing'; detail: string }
  | { available: false; reason: 'no-window'; detail: string }
  | { available: false; reason: RendererUrlProblem; detail: string };

export type BrowserRendererConfig =
  | { available: true; url: string; origin: string }
  | BrowserRendererConfigFailure;

/**
 * Read-only operator configuration. There is deliberately no user-editable endpoint:
 * the renderer is a deployment surface, not a per-user setting. A missing or unsafe
 * value makes browser rendering unavailable; it never falls back to cloud silently.
 */
export function resolveBrowserRendererConfig(): BrowserRendererConfig {
  const raw = String(import.meta.env.VITE_BROWSER_RENDERER_URL ?? '').trim();
  if (!raw) {
    return {
      available: false,
      reason: 'missing',
      detail: 'VITE_BROWSER_RENDERER_URL is not configured',
    };
  }
  if (typeof window === 'undefined') {
    return {
      available: false,
      reason: 'no-window',
      detail: 'Browser rendering requires a browser window',
    };
  }
  const validation = validateRendererUrl(raw, window.location, window.isSecureContext);
  if (!validation.ok) {
    return {
      available: false,
      reason: validation.problem,
      detail: validation.message,
    };
  }
  return {
    available: true,
    url: validation.url.href,
    origin: validation.url.origin,
  };
}
