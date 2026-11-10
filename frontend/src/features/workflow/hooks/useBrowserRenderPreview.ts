import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserRenderError,
  createBrowserRenderSession,
  detectBrowserRenderSupport,
  resolveBrowserRendererConfig,
  type BrowserRenderCapability,
  type BrowserRendererConfigFailure,
  type BrowserRenderSession,
  type RenderSessionState,
} from '../../browser-rendering';
import { fetchBrowserRenderNarration } from '../../../infrastructure/api/api';
import type {
  BrowserRenderVideoPreparedPayload,
  RenderTarget,
} from '../../../shared/types/api';

export type BrowserPreviewStatus =
  | 'checking'
  | 'unconfigured'
  | 'unsupported'
  | 'mounting'
  | 'starting'
  | 'rendering'
  | 'ready'
  | 'error';

export interface BrowserRenderPreviewModel {
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: BrowserPreviewStatus;
  sessionState: RenderSessionState | null;
  error: Error | null;
  configFailure: BrowserRendererConfigFailure | null;
  capabilityFailure: Extract<BrowserRenderCapability, { supported: false }> | null;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
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
  return new Error(typeof value === 'string' ? value : 'Browser rendering failed');
}

/**
 * React lifecycle owner for one prepared browser render.
 *
 * mount -> start -> whenReady is exactly the public runtime sequence. Every exit
 * (new payload, new attempt, unmount, target switch) disposes the session, which is the
 * hard stop for the iframe, worker, WebGPU player and audio graph. A local retry remounts
 * this hook with the same prepared payload; it never asks the server to generate again.
 */
export function useBrowserRenderPreview(
  jobId: string,
  payload: BrowserRenderVideoPreparedPayload,
  renderTarget: RenderTarget,
): BrowserRenderPreviewModel {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<BrowserRenderSession | null>(null);
  const [config] = useState(resolveBrowserRendererConfig);
  const [status, setStatus] = useState<BrowserPreviewStatus>(
    config.available ? 'checking' : 'unconfigured',
  );
  const [sessionState, setSessionState] = useState<RenderSessionState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const configFailure: BrowserRendererConfigFailure | null = config.available ? null : config;
  const [capabilityFailure, setCapabilityFailure] = useState<
    Extract<BrowserRenderCapability, { supported: false }> | null
  >(null);

  useEffect(() => {
    if (!config.available) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    let unsubscribe: (() => void) | null = null;
    let session: BrowserRenderSession | null = null;

    const run = async (): Promise<void> => {
      if (renderTarget !== 'browser') {
        throw new BrowserRenderError(
          'invalid-input',
          'This preview only accepts a browser-prepared result',
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
        throw new BrowserRenderError('internal', 'The preview container is not mounted');
      }

      session = createBrowserRenderSession({ rendererUrl: config.url });
      sessionRef.current = session;
      unsubscribe = session.subscribe((next) => {
        if (cancelled) return;
        setSessionState(next);
        if (next.error) setError(next.error);
        if (next.phase === 'error') setStatus('error');
      });

      setStatus('mounting');
      await session.mount(container);
      if (cancelled) return;

      setStatus('starting');
      let narration;
      if (payload.narration) {
        const audio = await fetchBrowserRenderNarration(
          jobId,
          payload.narration.audioUrl,
          payload.narration.byteLength,
          payload.narration.sha256,
          controller.signal,
        );
        if (cancelled) return;
        narration = {
          manifest: payload.narration.manifest,
          audio,
          format: 'wav' as const,
        };
      }

      await session.start({
        sessionId: createSessionId(),
        source: payload.source,
        ...(payload.sceneName ? { sceneName: payload.sceneName } : {}),
        frameRate: payload.frameRate,
        resolution: payload.resolution,
        ...(narration ? { narration } : {}),
      });
      if (cancelled) return;

      setStatus('rendering');
      await session.whenReady();
      if (cancelled) return;
      setStatus('ready');
    };

    void run().catch((value: unknown) => {
      if (cancelled) return;
      setError(asError(value));
      setStatus('error');
      session?.dispose();
    });

    return () => {
      cancelled = true;
      controller.abort();
      unsubscribe?.();
      session?.dispose();
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };
  }, [config, jobId, payload, renderTarget]);

  const play = useCallback(() => {
    try {
      sessionRef.current?.play();
    } catch (value) {
      setError(asError(value));
    }
  }, []);

  const pause = useCallback(() => {
    try {
      sessionRef.current?.pause();
    } catch (value) {
      setError(asError(value));
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    try {
      sessionRef.current?.seek(seconds);
    } catch (value) {
      setError(asError(value));
    }
  }, []);

  return {
    containerRef,
    status,
    sessionState,
    error,
    configFailure,
    capabilityFailure,
    play,
    pause,
    seek,
  };
}
