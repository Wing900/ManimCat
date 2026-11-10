/**
 * The single frontend HTML entry now has two internal routes:
 *   /renderer  -> isolated browser-rendering frame (separate origin in deployment)
 *   everything else -> the main ManimCat application
 *
 * The route is chosen before importing either side, so the renderer never initializes
 * App, I18nProvider, connection/settings hooks or API state, and the main application
 * never imports the WebGPU/Pyodide runtime. A legacy /browser-renderer.html URL is
 * normalized to /renderer instead of silently loading the main app.
 */

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root is missing');
}

const path = window.location.pathname;

// If this artifact is served on the configured renderer origin, the renderer route is
// the only application here. The deployment also writes _redirects, but this guard
// keeps a host that ignores that file from ever mounting the main app on the
// renderer origin. A missing/invalid env value leaves the main site unchanged.
const configuredRendererOrigin = (() => {
  try {
    return new URL(String(import.meta.env.VITE_BROWSER_RENDERER_URL ?? '')).origin;
  } catch {
    return null;
  }
})();

if (
  configuredRendererOrigin !== null &&
  window.location.origin === configuredRendererOrigin &&
  path !== '/renderer' &&
  path !== '/renderer/'
) {
  // The renderer origin is dedicated: every document path is the frame route.
  window.location.replace(`/renderer${window.location.search}${window.location.hash}`);
} else {
  if (path === '/browser-renderer.html') {
    const normalized = `/renderer${window.location.search}${window.location.hash}`;
    window.history.replaceState(null, '', normalized);
  } else if (path === '/renderer/') {
    const normalized = `/renderer${window.location.search}${window.location.hash}`;
    window.history.replaceState(null, '', normalized);
  }

  if (window.location.pathname === '/renderer' || window.location.pathname === '/renderer/') {
    void import('./features/browser-rendering/frame/entry').then(({ mountRendererFrame }) =>
      mountRendererFrame(root),
    );
  } else {
    void import('./app/main-app').then(({ mountMainApp }) => mountMainApp(root));
  }
}
