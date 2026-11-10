import {
  BROWSER_RENDER_PROTOCOL_VERSION,
  BrowserRenderError,
  DEFAULT_BOOT_TIMEOUT_MS,
  DEFAULT_FRAME_READY_TIMEOUT_MS,
  DEFAULT_RENDER_TIMEOUT_MS,
  MAX_IMAGE_BLOCKS,
  MAX_IMAGE_PNG_TOTAL_BYTES,
  deserializeRenderError,
  initialRenderState,
  type BrowserImageEvent,
  type BrowserRenderSessionOptions,
  type BrowserRenderSessionSnapshot,
  type RenderedImageBlock,
  type RenderImageSessionInput,
  type RenderSessionInput,
  type RenderSessionState,
} from './types';
import {
  fromWireState,
  parseFrameMessage,
  type ImageStartMessage,
  type ParentToFrame,
  type StartMessage,
} from './protocol';
import {
  normalizeImageSessionInput,
  normalizeSessionInput,
  resolveNarrationAudio,
  type NormalizedSessionInput,
} from './validation';
import { validateRendererUrl } from './renderer-url';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cloneState(state: RenderSessionState): RenderSessionState {
  return { ...state };
}

function isPng(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 8) return false;
  const view = new Uint8Array(bytes, 0, 8);
  return (
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  );
}

/**
 * Host-side owner of one isolated browser rendering frame.
 *
 * The renderer URL is explicit and must be a different origin from the host
 * application. The iframe is the hard-stop boundary: removing it destroys the
 * Pyodide worker, the WebGPU player and its audio graph.
 */
export class BrowserRenderSession {
  #options: Required<
    Pick<BrowserRenderSessionOptions, 'frameReadyTimeoutMs' | 'bootTimeoutMs' | 'renderTimeoutMs'>
  >;
  #rendererUrl: URL;
  #iframe: HTMLIFrameElement | null = null;
  #state: RenderSessionState = initialRenderState();
  #listeners = new Set<(state: RenderSessionState) => void>();
  #messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
  #pageHideHandler: (() => void) | null = null;
  #frameReady: Deferred<void> | null = null;
  #startDeferred: Deferred<void> | null = null;
  #readyWaiters: Deferred<void>[] = [];
  #activeSessionId: string | null = null;
  #mounted = false;
  #frameReadyResolved = false;
  #started = false;
  #starting = false;
  #failed = false;
  #disposed = false;
  #terminalError: BrowserRenderError | null = null;
  #frameReadyTimer: ReturnType<typeof setTimeout> | undefined;
  #bootTimer: ReturnType<typeof setTimeout> | undefined;
  #renderTimer: ReturnType<typeof setTimeout> | undefined;
  #imageDeferred: Deferred<void> | null = null;
  #imageListeners = new Set<(event: BrowserImageEvent) => void>();
  #imageMode = false;
  #imageExpectedIndexes = new Set<number>();
  #imageReceivedIndexes = new Set<number>();
  #imageReceived = 0;
  #imageExpectedCount = 0;
  #imageWidth = 0;
  #imageHeight = 0;
  #imageReceivedBytes = 0;

  constructor(options: BrowserRenderSessionOptions) {
    if (typeof window === 'undefined') {
      throw new BrowserRenderError('internal', 'BrowserRenderSession requires a browser window');
    }
    this.#rendererUrl = this.#validateRendererUrl(options.rendererUrl);
    this.#options = {
      frameReadyTimeoutMs: options.frameReadyTimeoutMs ?? DEFAULT_FRAME_READY_TIMEOUT_MS,
      bootTimeoutMs: options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS,
      renderTimeoutMs: options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
    };
  }

  get rendererOrigin(): string {
    return this.#rendererUrl.origin;
  }

  getState(): RenderSessionState {
    return cloneState(this.#state);
  }

  snapshot(): BrowserRenderSessionSnapshot {
    return {
      state: cloneState(this.#state),
      rendererOrigin: this.#rendererUrl.origin,
    };
  }

  subscribe(listener: (state: RenderSessionState) => void): () => void {
    this.#listeners.add(listener);
    listener(cloneState(this.#state));
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Subscribe to typed image progress/block/completion events before startImages(). */
  onImage(listener: (event: BrowserImageEvent) => void): () => void {
    this.#imageListeners.add(listener);
    return () => {
      this.#imageListeners.delete(listener);
    };
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.#disposed) {
      throw new BrowserRenderError('disposed', 'The render session is disposed');
    }
    if (this.#failed) {
      throw this.#terminalError ?? this.#state.error ??
        new BrowserRenderError('internal', 'The render session has failed');
    }
    if (this.#mounted) {
      throw new BrowserRenderError('protocol', 'The render session is already mounted');
    }
    if (!(container instanceof HTMLElement)) {
      throw new BrowserRenderError('invalid-input', 'mount() needs an HTMLElement container');
    }
    this.#mounted = true;
    this.#frameReadyResolved = false;
    this.#frameReady = deferred<void>();
    this.#messageHandler = (event) => this.#receive(event);
    window.addEventListener('message', this.#messageHandler);
    this.#pageHideHandler = () => this.dispose();
    window.addEventListener('pagehide', this.#pageHideHandler, { once: true });
    this.#frameReadyTimer = setTimeout(() => {
      this.#failAndStop(
        new BrowserRenderError('frame-timeout', 'The browser renderer frame did not become ready'),
      );
    }, this.#options.frameReadyTimeoutMs);
    const iframe = document.createElement('iframe');
    iframe.title = 'ManimCat 浏览器渲染器';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    iframe.allowFullscreen = true;
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.background = '#000';
    const url = new URL(this.#rendererUrl.href);
    url.searchParams.set('parent', window.location.origin);
    iframe.src = url.href;
    this.#iframe = iframe;
    container.replaceChildren(iframe);
    try {
      await this.#frameReady.promise;
    } catch (error) {
      if (error instanceof BrowserRenderError) throw error;
      throw new BrowserRenderError('frame-timeout', 'The browser renderer frame did not become ready');
    }
  }

  async start(input: RenderSessionInput): Promise<void> {
    if (this.#disposed) {
      throw new BrowserRenderError('disposed', 'The render session is disposed');
    }
    if (this.#failed) {
      throw this.#terminalError ?? this.#state.error ??
        new BrowserRenderError('internal', 'The render session has failed');
    }
    if (!this.#mounted || !this.#iframe || !this.#frameReadyResolved) {
      throw new BrowserRenderError(
        'invalid-input',
        'mount() must resolve and frame:ready must arrive before start()',
      );
    }
    if (this.#started || this.#starting) {
      throw new BrowserRenderError('protocol', 'This render session was already started');
    }
    this.#starting = true;
    let normalized: NormalizedSessionInput;
    try {
      const audio = await resolveNarrationAudio(input.narration);
      if (this.#disposed) {
        throw new BrowserRenderError('disposed', 'The render session was disposed');
      }
      normalized = normalizeSessionInput(input, audio);
    } catch (error) {
      if (this.#disposed) {
        throw new BrowserRenderError('disposed', 'The render session was disposed');
      }
      if (error instanceof BrowserRenderError) throw error;
      throw new BrowserRenderError('invalid-input', 'The session input is invalid', {
        detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : null,
        cause: error,
      });
    } finally {
      this.#starting = false;
    }
    if (this.#disposed) {
      throw new BrowserRenderError('disposed', 'The render session was disposed');
    }
    if (this.#failed) {
      throw this.#terminalError ?? this.#state.error ??
        new BrowserRenderError('internal', 'The render session has failed');
    }
    if (!this.#iframe || !this.#frameReadyResolved) {
      throw new BrowserRenderError('protocol', 'The renderer frame is no longer ready');
    }
    this.#activeSessionId = normalized.sessionId;
    this.#startDeferred = deferred<void>();
    this.#bootTimer = setTimeout(() => {
      this.#failAndStop(
        new BrowserRenderError('timeout', 'The browser renderer did not boot in time'),
      );
    }, this.#options.bootTimeoutMs);
    const message: StartMessage = {
      v: BROWSER_RENDER_PROTOCOL_VERSION,
      type: 'session:start',
      sessionId: normalized.sessionId,
      input: {
        sessionId: normalized.sessionId,
        source: normalized.source,
        sceneName: normalized.sceneName,
        frameRate: normalized.frameRate,
        resolution: normalized.resolution,
        narration: normalized.narration
          ? {
              manifest: normalized.narration.manifest,
              audio: normalized.narration.audio,
              format: 'wav',
            }
          : null,
      },
    };
    try {
      this.#post(message, normalized.narration ? [normalized.narration.audio] : []);
    } catch (error) {
      this.#failAndStop(
        new BrowserRenderError('protocol', 'The session start message could not be posted', {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      throw this.#terminalError ?? this.#state.error ??
        new BrowserRenderError('protocol', 'The session start message could not be posted');
    }
    this.#started = true;
    try {
      await this.#startDeferred.promise;
    } finally {
      this.#startDeferred = null;
    }
  }

  async startImages(input: RenderImageSessionInput): Promise<void> {
    if (this.#disposed) {
      throw new BrowserRenderError('disposed', 'The render session is disposed');
    }
    if (this.#failed) {
      throw this.#terminalError ?? this.#state.error ??
        new BrowserRenderError('internal', 'The render session has failed');
    }
    if (!this.#mounted || !this.#iframe || !this.#frameReadyResolved) {
      throw new BrowserRenderError(
        'invalid-input',
        'mount() must resolve and frame:ready must arrive before startImages()',
      );
    }
    if (this.#started || this.#starting) {
      throw new BrowserRenderError('protocol', 'This render session was already started');
    }
    this.#starting = true;
    let normalized: ReturnType<typeof normalizeImageSessionInput>;
    try {
      normalized = normalizeImageSessionInput(input, MAX_IMAGE_BLOCKS);
    } catch (error) {
      if (error instanceof BrowserRenderError) throw error;
      throw new BrowserRenderError('invalid-input', 'The image session input is invalid', {
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#starting = false;
    }
    if (this.#disposed) {
      throw new BrowserRenderError('disposed', 'The render session is disposed');
    }
    this.#imageMode = true;
    this.#activeSessionId = normalized.sessionId;
    this.#imageExpectedCount = normalized.blocks.length;
    this.#imageExpectedIndexes = new Set(normalized.blocks.map((block) => block.index));
    this.#imageReceivedIndexes.clear();
    this.#imageReceived = 0;
    this.#imageWidth = normalized.resolution.width;
    this.#imageHeight = normalized.resolution.height;
    this.#imageReceivedBytes = 0;
    this.#imageDeferred = deferred<void>();
    this.#renderTimer = setTimeout(() => {
      this.#failAndStop(
        new BrowserRenderError('timeout', 'The browser image render exceeded its time budget'),
      );
    }, this.#options.renderTimeoutMs);
    const message: ImageStartMessage = {
      v: BROWSER_RENDER_PROTOCOL_VERSION,
      type: 'image:start',
      sessionId: normalized.sessionId,
      input: {
        sessionId: normalized.sessionId,
        blocks: normalized.blocks,
        frameRate: normalized.frameRate,
        resolution: normalized.resolution,
      },
    };
    try {
      this.#post(message);
    } catch (error) {
      this.#failAndStop(
        new BrowserRenderError('protocol', 'The image session start message could not be posted', {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      throw this.#terminalError ?? new BrowserRenderError(
        'protocol',
        'The image session start message could not be posted',
      );
    }
    this.#started = true;
    try {
      await this.#imageDeferred.promise;
    } finally {
      this.#imageDeferred = null;
    }
  }

  whenReady(): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(new BrowserRenderError('disposed', 'The render session is disposed'));
    }
    if (this.#failed || this.#terminalError) {
      return Promise.reject(
        this.#terminalError ?? this.#state.error ??
          new BrowserRenderError('internal', 'The render session has failed'),
      );
    }
    if (this.#state.error) return Promise.reject(this.#state.error);
    if (this.#state.ready && this.#state.sceneComplete) return Promise.resolve();
    const waiter = deferred<void>();
    this.#readyWaiters.push(waiter);
    return waiter.promise;
  }

  play(): void {
    this.#command({ type: 'playback:play' });
  }

  pause(): void {
    this.#command({ type: 'playback:pause' });
  }

  seek(seconds: number): void {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new BrowserRenderError('invalid-input', 'seek() needs a finite, non-negative time');
    }
    this.#command({ type: 'playback:seek', seconds });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTimers();
    const disposed = new BrowserRenderError('disposed', 'The render session was disposed');
    this.#frameReady?.reject(disposed);
    this.#frameReady = null;
    this.#startDeferred?.reject(disposed);
    this.#startDeferred = null;
    this.#imageDeferred?.reject(disposed);
    this.#imageDeferred = null;
    this.#rejectWaiters(disposed);
    this.#imageListeners.clear();
    this.#imageReceivedBytes = 0;
    this.#imageExpectedIndexes.clear();
    this.#imageReceivedIndexes.clear();
    this.#removeFrame();
    this.#state = {
      ...this.#state,
      phase: 'disposed',
      ready: false,
      playing: false,
      statusText: null,
      error: this.#state.error,
    };
    this.#notify();
  }

  #validateRendererUrl(raw: string): URL {
    const validation = validateRendererUrl(
      raw,
      window.location,
      window.isSecureContext,
    );
    if (!validation.ok) {
      throw new BrowserRenderError('renderer-origin', validation.message);
    }
    return validation.url;
  }

  #command(
    message:
      | { type: 'playback:play' }
      | { type: 'playback:pause' }
      | { type: 'playback:seek'; seconds: number },
  ): void {
    if (this.#disposed) {
      throw new BrowserRenderError('disposed', 'The render session is disposed');
    }
    if (this.#failed) {
      throw new BrowserRenderError('protocol', 'The render session has failed');
    }
    if (this.#imageMode) {
      throw new BrowserRenderError(
        'invalid-input',
        'Playback commands are not valid for an image render session',
      );
    }
    if (!this.#started || !this.#activeSessionId) {
      throw new BrowserRenderError('invalid-input', 'start() must resolve before playback commands');
    }
    const base = {
      v: BROWSER_RENDER_PROTOCOL_VERSION,
      sessionId: this.#activeSessionId,
    } as const;
    if (message.type === 'playback:seek') {
      this.#post({ ...base, type: 'playback:seek', seconds: message.seconds });
    } else {
      this.#post({ ...base, type: message.type });
    }
  }

  #post(message: ParentToFrame, transfer: Transferable[] = []): void {
    const target = this.#iframe?.contentWindow;
    if (!target || !this.#frameReadyResolved) {
      throw new BrowserRenderError('protocol', 'The renderer frame is not ready for messages');
    }
    target.postMessage(message, this.#rendererUrl.origin, transfer);
  }

  #receive(event: MessageEvent<unknown>): void {
    if (this.#disposed) return;
    const iframe = this.#iframe;
    if (!iframe || event.source !== iframe.contentWindow) return;
    if (event.origin !== this.#rendererUrl.origin) return;
    const parsed = parseFrameMessage(event.data);
    if (!parsed.ok) {
      const record =
        typeof event.data === 'object' && event.data !== null
          ? (event.data as Record<string, unknown>)
          : null;
      const receivedVersion = record?.v;
      const receivedType = typeof record?.type === 'string' ? record.type : undefined;
      const detail =
        `expected v=${BROWSER_RENDER_PROTOCOL_VERSION}, ` +
        `received v=${String(receivedVersion)}, ` +
        `type=${String(receivedType)}, origin=${event.origin}`;
      console.error('[browser-rendering] protocol violation', {
        reason: parsed.reason,
        expected: BROWSER_RENDER_PROTOCOL_VERSION,
        receivedVersion,
        receivedType,
        origin: event.origin,
        iframe: this.#iframe?.src,
      });
      this.#protocolError(`Renderer protocol violation: ${parsed.reason} (${detail})`);
      return;
    }
    const message = parsed.value;
    if (message.type === 'frame:ready') {
      if (this.#failed || this.#disposed) return;
      if (this.#frameReadyTimer !== undefined) clearTimeout(this.#frameReadyTimer);
      this.#frameReadyTimer = undefined;
      this.#frameReadyResolved = true;
      this.#frameReady?.resolve();
      this.#frameReady = null;
      return;
    }
    if (!this.#activeSessionId || message.sessionId !== this.#activeSessionId) return;
    if (message.type === 'image:progress') {
      if (!this.#imageMode || this.#failed) return;
      if (
        message.total !== this.#imageExpectedCount ||
        message.completed > message.total ||
        !this.#imageExpectedIndexes.has(message.index)
      ) {
        this.#protocolError('Renderer sent invalid image progress');
        return;
      }
      for (const listener of this.#imageListeners) {
        try {
          listener({
            type: 'progress',
            progress: {
              completed: message.completed,
              total: message.total,
              index: message.index,
              statusText: message.statusText,
            },
          });
        } catch {
          // A UI listener must not break the session lifecycle.
        }
      }
      return;
    }
    if (message.type === 'image:block') {
      if (!this.#imageMode || this.#failed) return;
      if (this.#imageReceivedBytes + message.bytes.byteLength > MAX_IMAGE_PNG_TOTAL_BYTES) {
        this.#protocolError('Renderer image batch exceeded the encoded PNG byte limit');
        return;
      }
      if (
        !this.#imageExpectedIndexes.has(message.index) ||
        this.#imageReceivedIndexes.has(message.index) ||
        message.width !== this.#imageWidth ||
        message.height !== this.#imageHeight ||
        !isPng(message.bytes)
      ) {
        this.#protocolError('Renderer sent an invalid or duplicate image block');
        return;
      }
      this.#imageReceivedIndexes.add(message.index);
      this.#imageReceivedBytes += message.bytes.byteLength;
      this.#imageReceived += 1;
      const block: RenderedImageBlock = {
        index: message.index,
        width: message.width,
        height: message.height,
        bytes: message.bytes,
      };
      for (const listener of this.#imageListeners) {
        try {
          listener({ type: 'block', block });
        } catch {
          // A UI listener must not break the session lifecycle.
        }
      }
      return;
    }
    if (message.type === 'image:complete') {
      if (!this.#imageMode || this.#failed) return;
      if (
        message.count !== this.#imageExpectedCount ||
        this.#imageReceived !== this.#imageExpectedCount
      ) {
        this.#protocolError('Renderer completed an image batch with missing blocks');
        return;
      }
      this.#clearTimers();
      this.#imageDeferred?.resolve();
      this.#imageReceivedBytes = 0;
      for (const listener of this.#imageListeners) {
        try {
          listener({ type: 'complete', count: message.count });
        } catch {
          // A UI listener must not break the session lifecycle.
        }
      }
      return;
    }
    if (message.type === 'session:state') {
      if (this.#failed) return;
      const state = fromWireState(message.state);
      if (state.phase === 'disposed') {
        this.dispose();
        return;
      }
      if (state.phase === 'error') {
        const error =
          state.error ?? new BrowserRenderError('internal', 'The renderer reported a failure');
        // Store the typed fallback before the common failure path rejects start/waiters
        // and hard-removes the iframe. Never resolve start for an error state.
        this.#state = { ...state, error };
        this.#failAndStop(error);
        return;
      }
      this.#state = state;
      this.#startDeferred?.resolve();
      if (state.phase === 'rendering') {
        if (this.#bootTimer !== undefined) clearTimeout(this.#bootTimer);
        this.#bootTimer = undefined;
        this.#armRenderTimeout();
      }
      if (state.ready && state.sceneComplete) {
        this.#clearTimers();
        this.#resolveWaiters();
      }
      this.#notify();
      return;
    }
    if (message.type === 'session:progress') {
      if (this.#failed) return;
      this.#state = {
        ...this.#state,
        currentTime: message.currentTime,
        duration: message.duration,
      };
      this.#notify();
      return;
    }
    if (message.type === 'session:complete') {
      if (this.#failed) return;
      this.#state = {
        ...this.#state,
        phase: this.#state.playing ? 'playing' : 'ready',
        ready: true,
        sceneComplete: true,
        duration: message.duration,
        narration: message.narration,
        visualCheck: message.visualCheck,
        cjk: message.cjk,
        statusText: null,
      };
      this.#clearTimers();
      this.#startDeferred?.resolve();
      this.#resolveWaiters();
      this.#notify();
      return;
    }
    if (message.type === 'session:error') {
      this.#failAndStop(deserializeRenderError(message.error));
      return;
    }
    if (message.type === 'session:disposed') {
      this.dispose();
    }
  }

  #protocolError(message: string): void {
    this.#failAndStop(new BrowserRenderError('protocol', message));
  }

  #failAndStop(error: BrowserRenderError): void {
    if (this.#disposed || this.#failed) return;
    this.#failed = true;
    this.#terminalError = error;
    this.#clearTimers();
    this.#frameReady?.reject(error);
    this.#frameReady = null;
    this.#state = {
      ...this.#state,
      phase: 'error',
      ready: false,
      playing: false,
      statusText: null,
      error,
    };
    this.#startDeferred?.reject(error);
    this.#startDeferred = null;
    this.#imageDeferred?.reject(error);
    this.#imageDeferred = null;
    this.#rejectWaiters(error);
    // The iframe is the hard stop for the worker, WebGPU player and audio graph.
    this.#removeFrame();
    this.#notify();
  }

  #armRenderTimeout(): void {
    if (this.#renderTimer !== undefined) clearTimeout(this.#renderTimer);
    this.#renderTimer = setTimeout(() => {
      this.#failAndStop(
        new BrowserRenderError('timeout', 'The browser render exceeded its time budget'),
      );
    }, this.#options.renderTimeoutMs);
  }

  #resolveWaiters(): void {
    const waiters = this.#readyWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
  }

  #rejectWaiters(error: unknown): void {
    const waiters = this.#readyWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  #removeFrame(): void {
    this.#clearTimers();
    if (this.#messageHandler) {
      window.removeEventListener('message', this.#messageHandler);
      this.#messageHandler = null;
    }
    if (this.#pageHideHandler) {
      window.removeEventListener('pagehide', this.#pageHideHandler);
      this.#pageHideHandler = null;
    }
    const iframe = this.#iframe;
    this.#iframe = null;
    if (iframe) {
      try {
        iframe.src = 'about:blank';
      } catch {
        // The iframe is about to be removed anyway.
      }
      iframe.remove();
    }
    this.#mounted = false;
    this.#frameReadyResolved = false;
  }

  #clearTimers(): void {
    if (this.#frameReadyTimer !== undefined) clearTimeout(this.#frameReadyTimer);
    if (this.#bootTimer !== undefined) clearTimeout(this.#bootTimer);
    if (this.#renderTimer !== undefined) clearTimeout(this.#renderTimer);
    this.#frameReadyTimer = undefined;
    this.#bootTimer = undefined;
    this.#renderTimer = undefined;
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      try {
        listener(cloneState(this.#state));
      } catch {
        // A listener must not break the session's lifecycle.
      }
    }
  }
}

export function createBrowserRenderSession(
  options: BrowserRenderSessionOptions,
): BrowserRenderSession {
  return new BrowserRenderSession(options);
}
