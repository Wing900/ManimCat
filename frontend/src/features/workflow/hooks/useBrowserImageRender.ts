import { useEffect, useRef, useState } from 'react';
import {
  BrowserRenderError,
  createBrowserRenderSession,
  detectBrowserRenderSupport,
  resolveBrowserRendererConfig,
  type BrowserImageEvent,
  type BrowserRenderCapability,
  type BrowserRendererConfigFailure,
  type BrowserRenderSession,
  type ImageRenderProgress,
} from '../../browser-rendering';
import type {
  BrowserRenderImagePreparedPayload,
  RenderTarget,
} from '../../../shared/types/api';

export type BrowserImageStatus =
  | 'checking'
  | 'unconfigured'
  | 'unsupported'
  | 'mounting'
  | 'starting'
  | 'rendering'
  | 'complete'
  | 'error';

export interface BrowserImageResult {
  index: number;
  url: string;
  width: number;
  height: number;
}

export interface BrowserImageRenderModel {
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: BrowserImageStatus;
  images: BrowserImageResult[];
  progress: ImageRenderProgress | null;
  error: Error | null;
  configFailure: BrowserRendererConfigFailure | null;
  capabilityFailure: Extract<BrowserRenderCapability, { supported: false }> | null;
}

function createSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Browser image rendering failed');
}

/**
 * Owns the isolated frame for one prepared browser image batch. The frame renders
 * each block sequentially and posts clean PNG bytes; this host turns those bytes into
 * object URLs, which are revoked on retry, payload change and unmount. A failed block
 * rejects the batch while the already delivered images remain visible and retryable.
 */
export function useBrowserImageRender(
  jobId: string,
  payload: BrowserRenderImagePreparedPayload,
  renderTarget: RenderTarget,
): BrowserImageRenderModel {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [config] = useState(resolveBrowserRendererConfig);
  const [status, setStatus] = useState<BrowserImageStatus>(
    config.available ? 'checking' : 'unconfigured',
  );
  const [images, setImages] = useState<BrowserImageResult[]>([]);
  const [progress, setProgress] = useState<ImageRenderProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const configFailure: BrowserRendererConfigFailure | null = config.available ? null : config;
  const [capabilityFailure, setCapabilityFailure] = useState<
    Extract<BrowserRenderCapability, { supported: false }> | null
  >(null);

  useEffect(() => {
    if (!config.available) return undefined;

    let cancelled = false;
    let session: BrowserRenderSession | null = null;
    let unsubscribe: (() => void) | null = null;
    const objectUrls = new Set<string>();

    const run = async (): Promise<void> => {
      if (renderTarget !== 'browser') {
        throw new BrowserRenderError(
          'invalid-input',
          'This image result only accepts a browser-prepared payload',
        );
      }

      const capability = await detectBrowserRenderSupport();
      if (cancelled) return;
      if (!capability.supported) {
        setCapabilityFailure(capability);
        setStatus('unsupported');
        return;
      }
      const container = containerRef.current;
      if (!container) {
        throw new BrowserRenderError('internal', 'The image preview container is not mounted');
      }

      session = createBrowserRenderSession({ rendererUrl: config.url });
      unsubscribe = session.onImage((event: BrowserImageEvent) => {
        if (cancelled) return;
        if (event.type === 'progress') {
          setProgress(event.progress);
          setStatus((current) => (current === 'complete' ? current : 'rendering'));
          return;
        }
        if (event.type === 'block') {
          const url = URL.createObjectURL(
            new Blob([event.block.bytes], { type: 'image/png' }),
          );
          objectUrls.add(url);
          setImages((current) => [
            ...current,
            {
              index: event.block.index,
              url,
              width: event.block.width,
              height: event.block.height,
            },
          ]);
          return;
        }
        setStatus('complete');
      });

      setStatus('mounting');
      await session.mount(container);
      if (cancelled) return;

      setStatus('starting');
      await session.startImages({
        sessionId: createSessionId(),
        blocks: payload.blocks,
        frameRate: payload.frameRate,
        resolution: payload.resolution,
      });
      if (cancelled) return;
      // The PNGs are now owned by this host as object URLs; the worker, WebGPU
      // player and pending readback can be released without unmounting the result.
      session.dispose();
      session = null;
      setStatus('complete');
    };

    void run().catch((value: unknown) => {
      if (cancelled) return;
      setError(asError(value));
      setStatus('error');
      session?.dispose();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      session?.dispose();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, [config, jobId, payload, renderTarget]);

  return {
    containerRef,
    status,
    images,
    progress,
    error,
    configFailure,
    capabilityFailure,
  };
}
