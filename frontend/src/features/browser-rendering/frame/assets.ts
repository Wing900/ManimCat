import { BrowserRenderError } from '../types';
import type { WheelAsset } from '../engine/worker-protocol';

const ASSET_SCHEMA = 'manimcat.browser-rendering-assets.v1';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_RUNTIME_SOURCE_BYTES = 512 * 1024;
const REQUIRED_WHEELS = new Set([
  'manimgx',
  'manimgx-fonts',
  'manimgx-fonts-cjk',
  'isosurfaces',
  'svgelements',
]);

// Build-time pins from scripts/browser-rendering/prepare-assets.mjs. This rejects an
// obviously stale or mislabelled wheel entry; it is not a signature over the manifest.
const PINNED_WHEELS: Record<string, string> = {
  manimgx: '0.1.1',
  'manimgx-fonts': '2026.9.26.post1',
  'manimgx-fonts-cjk': '2026.9.26.post1',
  isosurfaces: '0.1.2',
  svgelements: '1.9.6',
};

export interface AssetManifest {
  schema: string;
  engine: {
    manimgx: string;
    pyodide: string;
    /** The patched browser engine that can read a clean image frame; absent in video-only builds. */
    web?: {
      commit: string;
      js: string;
      jsSha256: string;
      wasm: string;
      wasmSha256: string;
    };
  };
  pyodide: { indexUrl: string };
  wheels: WheelAsset[];
  python: { narrationRuntime: { file: string; sha256: string } };
}

export interface AssetBundle {
  base: URL;
  manifestUrl: URL;
  manifest: AssetManifest;
  pyodideUrl: string;
  wheels: WheelAsset[];
}

export interface WebEngineAssets {
  js: string;
  wasm: ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256Hex(data: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', data).then((digest) => {
    const bytes = new Uint8Array(digest);
    let out = '';
    for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
    return out;
  });
}

function sameOriginUrl(value: string, base: URL, label: string): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new BrowserRenderError('asset', `${label} is not a valid URL`);
  }
  if (url.origin !== location.origin) {
    throw new BrowserRenderError('asset', `${label} must stay on the renderer origin`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BrowserRenderError('asset', `${label} must use HTTP(S)`);
  }
  if (url.username || url.password) {
    throw new BrowserRenderError('asset', `${label} must not contain credentials`);
  }
  return url;
}

export function resolveAssetBase(): URL {
  const params = new URLSearchParams(location.search);
  const override = params.get('assets');
  const base = sameOriginUrl(
    override ?? new URL('browser-rendering/', location.origin).href,
    new URL(location.href),
    'asset base',
  );
  if (!base.pathname.endsWith('/')) {
    throw new BrowserRenderError('asset', 'asset base must end with a slash');
  }
  return base;
}

// Runtime integrity covers the wheel entries and narration_runtime.py. Pyodide core
// files, its lockfile and loadPackage payloads are pinned by prepare-assets.mjs at
// build time; this manifest is same-origin and unsigned, so deployment must treat the
// renderer origin as immutable. Do not describe that build-time pinning as runtime
// verification.
function validateManifest(value: unknown, manifestUrl: URL): AssetManifest {
  if (!isRecord(value)) throw new BrowserRenderError('asset', 'Asset manifest is not an object');
  if (value.schema !== ASSET_SCHEMA) {
    throw new BrowserRenderError('asset', 'Asset manifest schema is not supported');
  }
  if (!isRecord(value.engine)) throw new BrowserRenderError('asset', 'Asset manifest has no engine');
  if (value.engine.manimgx !== '0.1.1' || value.engine.pyodide !== '314.0.7') {
    throw new BrowserRenderError(
      'asset',
      'Asset manifest does not pin manimgx 0.1.1 and Pyodide 314.0.7',
    );
  }
  let webEngine: AssetManifest['engine']['web'];
  if (value.engine.web !== undefined) {
    const raw = value.engine.web;
    if (
      !isRecord(raw) ||
      raw.commit !== '0507708dc5d731478786de2f46ca8a1660d514d6' ||
      typeof raw.js !== 'string' ||
      typeof raw.wasm !== 'string' ||
      typeof raw.jsSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(raw.jsSha256) ||
      typeof raw.wasmSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(raw.wasmSha256)
    ) {
      throw new BrowserRenderError('asset', 'Asset manifest has an invalid browser engine entry');
    }
    sameOriginUrl(raw.js, manifestUrl, 'Browser engine JS');
    sameOriginUrl(raw.wasm, manifestUrl, 'Browser engine WASM');
    webEngine = {
      commit: raw.commit,
      js: raw.js,
      jsSha256: raw.jsSha256,
      wasm: raw.wasm,
      wasmSha256: raw.wasmSha256,
    };
  }
  if (!isRecord(value.pyodide) || typeof value.pyodide.indexUrl !== 'string') {
    throw new BrowserRenderError('asset', 'Asset manifest has no Pyodide index');
  }
  const pyodideUrl = sameOriginUrl(value.pyodide.indexUrl, manifestUrl, 'Pyodide index');
  if (!pyodideUrl.pathname.endsWith('/')) {
    throw new BrowserRenderError('asset', 'Pyodide index must end with a slash');
  }
  if (!Array.isArray(value.wheels) || value.wheels.length === 0) {
    throw new BrowserRenderError('asset', 'Asset manifest has no wheels');
  }
  const wheels: WheelAsset[] = [];
  const names = new Set<string>();
  for (const raw of value.wheels) {
    if (!isRecord(raw)) throw new BrowserRenderError('asset', 'Invalid wheel entry');
    if (
      typeof raw.name !== 'string' ||
      typeof raw.version !== 'string' ||
      typeof raw.file !== 'string' ||
      typeof raw.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(raw.sha256)
    ) {
      throw new BrowserRenderError('asset', 'Invalid wheel entry');
    }
    if (names.has(raw.name)) throw new BrowserRenderError('asset', 'Duplicate wheel entry');
    const pinnedVersion = PINNED_WHEELS[raw.name];
    if (pinnedVersion === undefined || pinnedVersion !== raw.version) {
      throw new BrowserRenderError('asset', `Wheel ${raw.name} does not match the pinned version`);
    }
    const wheelUrl = sameOriginUrl(raw.file, manifestUrl, `Wheel ${raw.name}`);
    const filename = wheelUrl.pathname.split('/').pop() ?? '';
    const expectedPrefix = `${raw.name.replace(/-/g, '_')}-${raw.version}`;
    if (!filename.startsWith(expectedPrefix)) {
      throw new BrowserRenderError('asset', `Wheel ${raw.name} has a mismatched filename`);
    }
    names.add(raw.name);
    wheels.push({
      name: raw.name,
      version: raw.version,
      url: wheelUrl.href,
      sha256: raw.sha256,
    });
  }
  for (const required of REQUIRED_WHEELS) {
    if (!names.has(required)) {
      throw new BrowserRenderError('asset', `Asset manifest is missing ${required}`);
    }
  }
  if (!isRecord(value.python) || !isRecord(value.python.narrationRuntime)) {
    throw new BrowserRenderError('asset', 'Asset manifest has no narration runtime');
  }
  const narration = value.python.narrationRuntime;
  if (
    typeof narration.file !== 'string' ||
    typeof narration.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(narration.sha256)
  ) {
    throw new BrowserRenderError('asset', 'Invalid narration runtime entry');
  }
  sameOriginUrl(narration.file, manifestUrl, 'Narration runtime');
  return {
    schema: ASSET_SCHEMA,
    engine: { manimgx: '0.1.1', pyodide: '314.0.7', ...(webEngine ? { web: webEngine } : {}) },
    pyodide: { indexUrl: pyodideUrl.href },
    wheels,
    python: {
      narrationRuntime: { file: narration.file, sha256: narration.sha256 },
    },
  };
}

export async function loadAssetBundle(): Promise<AssetBundle> {
  const base = resolveAssetBase();
  const manifestUrl = new URL('vendor/manifest.json', base);
  const response = await fetch(manifestUrl, { credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) {
    throw new BrowserRenderError(
      'asset',
      `Cannot load the browser renderer assets (HTTP ${response.status}). Run the asset preparation script first.`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new BrowserRenderError('asset', 'Asset manifest has an invalid size');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BrowserRenderError('asset', 'Asset manifest is not valid JSON');
  }
  const manifest = validateManifest(raw, manifestUrl);
  return {
    base,
    manifestUrl,
    manifest,
    pyodideUrl: manifest.pyodide.indexUrl,
    wheels: manifest.wheels,
  };
}

export async function loadNarrationRuntime(bundle: AssetBundle): Promise<string> {
  const entry = bundle.manifest.python.narrationRuntime;
  const url = sameOriginUrl(entry.file, bundle.manifestUrl, 'Narration runtime');
  const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) {
    throw new BrowserRenderError(
      'asset',
      `Cannot load the narration runtime (HTTP ${response.status})`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RUNTIME_SOURCE_BYTES) {
    throw new BrowserRenderError('asset', 'Narration runtime has an invalid size');
  }
  const digest = await sha256Hex(bytes);
  if (digest !== entry.sha256) {
    throw new BrowserRenderError('asset', 'Narration runtime failed integrity verification');
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BrowserRenderError('asset', 'Narration runtime is not valid UTF-8');
  }
  if (!source.includes('class NarrationRuntime')) {
    throw new BrowserRenderError('asset', 'Narration runtime does not contain NarrationRuntime');
  }
  return source;
}

const MAX_ENGINE_JS_BYTES = 16 * 1024 * 1024;
const MAX_ENGINE_WASM_BYTES = 128 * 1024 * 1024;

/**
 * Load the build-time patched browser engine used only by image capture. The wheel's
 * embedded engine remains the video path; this engine adds `Player.render_image`.
 * Same-origin URLs and the manifest's exact SHA-256 values are required. A missing
 * entry is a hard product error, never a fallback to a canvas screenshot.
 */
export async function loadWebEngine(bundle: AssetBundle): Promise<WebEngineAssets> {
  const entry = bundle.manifest.engine.web;
  if (!entry) {
    throw new BrowserRenderError(
      'asset',
      'Browser image rendering needs the patched engine assets. Run scripts/browser-rendering/build-engine.mjs and rebuild the renderer.',
    );
  }
  const jsUrl = sameOriginUrl(entry.js, bundle.manifestUrl, 'Browser engine JS');
  const wasmUrl = sameOriginUrl(entry.wasm, bundle.manifestUrl, 'Browser engine WASM');

  const [jsResponse, wasmResponse] = await Promise.all([
    fetch(jsUrl, { credentials: 'omit', cache: 'force-cache', redirect: 'error' }),
    fetch(wasmUrl, { credentials: 'omit', cache: 'force-cache', redirect: 'error' }),
  ]);
  if (!jsResponse.ok) {
    throw new BrowserRenderError(
      'asset',
      `Cannot load the browser engine JS (HTTP ${jsResponse.status})`,
    );
  }
  if (!wasmResponse.ok) {
    throw new BrowserRenderError(
      'asset',
      `Cannot load the browser engine WASM (HTTP ${wasmResponse.status})`,
    );
  }
  const jsBytes = await jsResponse.arrayBuffer();
  const wasmBytes = await wasmResponse.arrayBuffer();
  if (jsBytes.byteLength === 0 || jsBytes.byteLength > MAX_ENGINE_JS_BYTES) {
    throw new BrowserRenderError('asset', 'Browser engine JS has an invalid size');
  }
  if (wasmBytes.byteLength === 0 || wasmBytes.byteLength > MAX_ENGINE_WASM_BYTES) {
    throw new BrowserRenderError('asset', 'Browser engine WASM has an invalid size');
  }
  const [jsDigest, wasmDigest] = await Promise.all([sha256Hex(jsBytes), sha256Hex(wasmBytes)]);
  if (jsDigest !== entry.jsSha256 || wasmDigest !== entry.wasmSha256) {
    throw new BrowserRenderError('asset', 'Browser engine failed integrity verification');
  }
  let js: string;
  try {
    js = new TextDecoder('utf-8', { fatal: true }).decode(jsBytes);
  } catch {
    throw new BrowserRenderError('asset', 'Browser engine JS is not valid UTF-8');
  }
  if (!js.includes('render_image')) {
    throw new BrowserRenderError(
      'asset',
      'Browser engine does not expose clean image readback',
    );
  }
  return { js, wasm: wasmBytes };
}
