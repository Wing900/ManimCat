/**
 * One validation rule for the operator-supplied renderer origin.
 *
 * Both the settings preflight and BrowserRenderSession use this module, so a URL that
 * the Settings page calls valid cannot fail a later mount for a different reason (or
 * vice versa). The renderer must stay on a separate, secure origin; credentials are
 * never accepted in the URL.
 */

export type RendererUrlProblem =
  | 'invalid-url'
  | 'non-http'
  | 'credentials'
  | 'same-origin'
  | 'https-required'
  | 'host-insecure'
  | 'renderer-https-required'
  | 'insecure-context'
  | 'entry-required';

export type RendererUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; problem: RendererUrlProblem; message: string };

export interface RendererHostLocation {
  href: string;
  origin: string;
  protocol: string;
  hostname: string;
}

export const RENDERER_ROUTE = '/renderer';

function isLocalHost(name: string): boolean {
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}

/**
 * The shared build emits index.html and the internal renderer route /renderer. An
 * origin-only or directory URL is normalized to that route. The retired standalone
 * browser-renderer.html name is normalized to /renderer instead of loading the main
 * application. Any other HTML path is rejected with a config error.
 */
function normalizeRendererEntry(url: URL): URL | null {
  const normalized = new URL(url.href);
  normalized.hash = '';
  const path = normalized.pathname;
  const directory = path.endsWith('/') ? path : `${path.slice(0, path.lastIndexOf('/') + 1)}`;
  if (path === '' || path === '/') {
    normalized.pathname = RENDERER_ROUTE;
    return normalized;
  }
  if (path === '/browser-renderer.html' || path.endsWith('/browser-renderer.html')) {
    normalized.pathname = path.slice(0, -'browser-renderer.html'.length) + 'renderer';
    return normalized;
  }
  if (path === '/renderer' || path === '/renderer/' || path.endsWith('/renderer') || path.endsWith('/renderer/')) {
    normalized.pathname = path.endsWith('/') ? path.slice(0, -1) : path;
    if (normalized.pathname === '') normalized.pathname = RENDERER_ROUTE;
    return normalized;
  }
  if (path.endsWith('/')) {
    normalized.pathname = `${path}renderer`;
    return normalized;
  }
  if (path.endsWith('/index.html')) {
    normalized.pathname = `${directory}renderer`;
    return normalized;
  }
  return null;
}

export function validateRendererUrl(
  raw: string,
  host: RendererHostLocation,
  isSecureContext: boolean,
): RendererUrlValidation {
  let url: URL;
  try {
    url = new URL(raw, host.href);
  } catch {
    return { ok: false, problem: 'invalid-url', message: 'rendererUrl is not a valid URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, problem: 'non-http', message: 'rendererUrl must use HTTP(S)' };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      problem: 'credentials',
      message: 'rendererUrl must not contain credentials',
    };
  }
  if (url.origin === host.origin) {
    return {
      ok: false,
      problem: 'same-origin',
      message: 'rendererUrl must not share the host application origin',
    };
  }
  const hostSecure = host.protocol === 'https:';
  const hostLocal = isLocalHost(host.hostname);
  const rendererLocal = isLocalHost(url.hostname);
  if (hostSecure && url.protocol !== 'https:') {
    return {
      ok: false,
      problem: 'https-required',
      message: 'A production host requires an HTTPS renderer origin',
    };
  }
  if (!hostSecure && !hostLocal) {
    return {
      ok: false,
      problem: 'host-insecure',
      message: 'The host page must be served over HTTPS (or localhost) before mounting a renderer',
    };
  }
  if (url.protocol === 'http:' && !rendererLocal) {
    return {
      ok: false,
      problem: 'renderer-https-required',
      message:
        'A production renderer origin must use HTTPS; plain HTTP is only allowed on localhost',
    };
  }
  if (!isSecureContext) {
    return {
      ok: false,
      problem: 'insecure-context',
      message: 'The host page is not a secure context; WebGPU cannot start',
    };
  }
  const entry = normalizeRendererEntry(url);
  if (!entry) {
    return {
      ok: false,
      problem: 'entry-required',
      message: `rendererUrl must point to the renderer route (${RENDERER_ROUTE})`,
    };
  }
  return { ok: true, url: entry };
}
