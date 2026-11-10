import {
  REQUIRED_WEBGPU_FEATURES,
  type BrowserRenderCapability,
} from './types';

/**
 * Minimal structural WebGPU types. The repository intentionally does not add
 * @webgpu/types for this independent module; these are the only members the
 * capability gate and error reporting touch.
 */
interface GpuFeatures {
  has(name: string): boolean;
}

interface GpuAdapter {
  readonly features: GpuFeatures;
  readonly isFallbackAdapter?: boolean;
}

interface GpuRequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
  forceFallbackAdapter?: boolean;
}

interface Gpu {
  requestAdapter(options?: GpuRequestAdapterOptions): Promise<GpuAdapter | null>;
}

interface NavigatorWithGpu extends Navigator {
  gpu?: Gpu;
}

export interface DetectCapabilityOptions {
  /** How long requestAdapter may take before the capability is reported unsupported. */
  adapterTimeoutMs?: number;
}

let cached: BrowserRenderCapability | null = null;
let pending: Promise<BrowserRenderCapability> | null = null;

function unsupported(
  reason: Extract<BrowserRenderCapability, { supported: false }>['reason'],
  detail: string,
  missingFeatures?: string[],
): BrowserRenderCapability {
  return missingFeatures
    ? { supported: false, reason, detail, missingFeatures }
    : { supported: false, reason, detail };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function detect(
  options: DetectCapabilityOptions,
): Promise<BrowserRenderCapability> {
  if (typeof window === 'undefined') {
    return unsupported('insecure-context', 'Window is not available');
  }
  if (!window.isSecureContext) {
    return unsupported(
      'insecure-context',
      'WebGPU requires a secure context (HTTPS or localhost)',
    );
  }
  const gpu = (navigator as NavigatorWithGpu).gpu;
  if (!gpu) {
    return unsupported('no-navigator-gpu', 'navigator.gpu is not available');
  }
  if (typeof Worker !== 'function') {
    return unsupported('no-worker', 'Web Workers are not available');
  }
  if (typeof WebAssembly === 'undefined') {
    return unsupported('no-wasm', 'WebAssembly is not available');
  }
  let adapter: GpuAdapter | null;
  try {
    const requested = gpu.requestAdapter({ powerPreference: 'high-performance' });
    const result = await withTimeout(requested, options.adapterTimeoutMs ?? 5000);
    if (result === 'timeout') {
      return unsupported('adapter-timeout', 'GPU adapter request timed out');
    }
    adapter = result;
  } catch (error) {
    return unsupported(
      'no-adapter',
      `GPU adapter request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!adapter) {
    return unsupported('no-adapter', 'No suitable GPU adapter was returned');
  }
  const missing = REQUIRED_WEBGPU_FEATURES.filter((feature) => !adapter.features.has(feature));
  if (missing.length > 0) {
    return unsupported(
      'missing-feature',
      `The GPU adapter lacks required feature(s): ${missing.join(', ')}`,
      missing,
    );
  }
  return {
    supported: true,
    adapter: { float32Blendable: true, depth32FloatStencil8: true },
  };
}

/**
 * Pure capability preflight. It never fetches application APIs, never submits a
 * cloud job and never changes a stored preference. A positive result is cached
 * for the session; call resetBrowserRenderSupportCache() to retry after a device
 * or browser state change.
 */
export function detectBrowserRenderSupport(
  options: DetectCapabilityOptions = {},
): Promise<BrowserRenderCapability> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = detect(options)
    .then((result) => {
      if (result.supported) cached = result;
      return result;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function resetBrowserRenderSupportCache(): void {
  cached = null;
  pending = null;
}
