/**
 * Page-side owner of the vendored Pyodide worker. It accepts the engine
 * handshake exactly once, before a run is dispatched, and authenticates every
 * subsequent worker message with a run token that is never passed into Python.
 */

import {
  BrowserRenderError,
  deserializeRenderError,
  type SerializedBrowserRenderError,
} from '../types';
import type { ManimgxEngine } from './engine-types';
import {
  WORKER_PROTOCOL_VERSION,
  type WorkerBootErrorMessage,
  type WorkerCommand,
  type WorkerDoneMessage,
  type WorkerEngineMessage,
  type WorkerFeedMessage,
  type WorkerStatusMessage,
  type WheelAsset,
} from './worker-protocol';

export interface DirectorDone {
  frameCount: number;
  sceneDuration: number;
  narration: {
    status: 'none' | 'included';
    audioDuration: number | null;
    videoDuration: number | null;
    warnings: string[];
    errors: string[];
  };
}

export interface DirectorClientCallbacks {
  onStatus(text: string): void;
  onEngine(engine: ManimgxEngine, cjk: boolean): void;
  onFeed(bytes: ArrayBuffer): void;
  onDone(done: DirectorDone): void;
  onError(error: BrowserRenderError): void;
}

export interface DirectorRunInput {
  source: string;
  sceneName: string | null;
  frameRate: number;
  resolution: { width: number; height: number };
  narration: {
    runtimeSource: string;
    manifestJson: string;
    audio: ArrayBuffer;
  } | null;
}

export interface DirectorImageRunInput {
  source: string;
  sceneName: string | null;
  frameRate: number;
  resolution: { width: number; height: number };
}

export interface DirectorClientOptions {
  /**
   * The patched engine's JS/WASM for clean image readback. When absent the wheel's
   * embedded engine is used (the unchanged video path).
   */
  engineAssets?: { js: string; wasm: ArrayBuffer };
}

interface ImageRun {
  runId: string;
  runToken: string;
  resolve: (done: DirectorDone) => void;
  reject: (error: BrowserRenderError) => void;
}

const MAX_FEED_BYTES = 96 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function randomId(): string {
  return randomToken();
}

function toError(
  value: unknown,
  fallback: BrowserRenderError,
): BrowserRenderError {
  if (!isRecord(value)) return fallback;
  const candidate = value as Partial<SerializedBrowserRenderError>;
  if (
    typeof candidate.code !== 'string' ||
    typeof candidate.message !== 'string' ||
    (candidate.detail !== null && typeof candidate.detail !== 'string') ||
    (candidate.line !== null && typeof candidate.line !== 'number')
  ) {
    return fallback;
  }
  return deserializeRenderError(candidate as SerializedBrowserRenderError);
}

function parseDirectorDone(message: WorkerDoneMessage): DirectorDone | null {
  if (
    typeof message.frameCount !== 'number' ||
    !Number.isFinite(message.frameCount) ||
    typeof message.sceneDuration !== 'number' ||
    !Number.isFinite(message.sceneDuration) ||
    !isRecord(message.narration)
  ) {
    return null;
  }
  const narration = message.narration;
  return {
    frameCount: message.frameCount,
    sceneDuration: message.sceneDuration,
    narration: {
      status: narration.status === 'included' ? 'included' : 'none',
      audioDuration:
        typeof narration.audioDuration === 'number' ? narration.audioDuration : null,
      videoDuration:
        typeof narration.videoDuration === 'number' ? narration.videoDuration : null,
      warnings: Array.isArray(narration.warnings)
        ? narration.warnings.filter((item): item is string => typeof item === 'string')
        : [],
      errors: Array.isArray(narration.errors)
        ? narration.errors.filter((item): item is string => typeof item === 'string')
        : [],
    },
  };
}

export class DirectorClient {
  #worker: Worker | null;
  #callbacks: DirectorClientCallbacks;
  #options: DirectorClientOptions;
  #sessionId: string;
  #bootId = '';
  #bootToken = '';
  #runId = '';
  #runToken = '';
  #bootDispatched = false;
  #engineReceived = false;
  #runDispatched = false;
  #runFinished = false;
  #disposed = false;
  #engineUrl: string | null = null;
  #imageRun: ImageRun | null = null;

  constructor(
    sessionId: string,
    callbacks: DirectorClientCallbacks,
    options: DirectorClientOptions = {},
  ) {
    this.#sessionId = sessionId;
    this.#callbacks = callbacks;
    this.#options = options;
    this.#worker = new Worker(new URL('./director.worker.ts', import.meta.url), {
      type: 'module',
      name: 'manimcat-browser-renderer',
    });
    this.#worker.onmessage = (event: MessageEvent<unknown>) => this.#receive(event.data);
    this.#worker.onerror = (event) => {
      if (this.#disposed) return;
      this.#fail(
        new BrowserRenderError('engine', 'The render worker crashed', {
          detail: event.message || null,
        }),
      );
    };
    this.#worker.onmessageerror = () => {
      if (this.#disposed) return;
      this.#fail(new BrowserRenderError('protocol', 'The render worker sent an unreadable message'));
    };
  }

  boot(pyodideUrl: string, wheels: WheelAsset[]): void {
    if (this.#disposed) throw new BrowserRenderError('disposed', 'The render session is disposed');
    if (this.#bootDispatched) {
      throw new BrowserRenderError('protocol', 'The render worker was already booted');
    }
    this.#bootDispatched = true;
    this.#bootId = randomId();
    this.#bootToken = randomToken();
    const command: WorkerCommand = {
      v: WORKER_PROTOCOL_VERSION,
      type: 'boot',
      bootId: this.#bootId,
      sessionId: this.#sessionId,
      bootToken: this.#bootToken,
      pyodideUrl,
      wheels,
    };
    this.#worker?.postMessage(command);
  }

  run(input: DirectorRunInput): void {
    if (this.#disposed) throw new BrowserRenderError('disposed', 'The render session is disposed');
    if (!this.#engineReceived || !this.#worker) {
      throw new BrowserRenderError('engine', 'The engine is not ready');
    }
    if (this.#runDispatched || this.#runFinished) {
      throw new BrowserRenderError('protocol', 'This render worker already ran a scene');
    }
    this.#runDispatched = true;
    this.#runId = randomId();
    this.#runToken = randomToken();
    const narration = input.narration
      ? { ...input.narration, audio: input.narration.audio }
      : null;
    const command: WorkerCommand = {
      v: WORKER_PROTOCOL_VERSION,
      type: 'run',
      bootId: this.#bootId,
      sessionId: this.#sessionId,
      runId: this.#runId,
      runToken: this.#runToken,
      mode: 'video',
      source: input.source,
      sceneName: input.sceneName,
      frameRate: input.frameRate,
      resolution: input.resolution,
      narration,
    };
    const transfer = narration ? [narration.audio] : [];
    this.#worker.postMessage(command, transfer);
  }

  /** Run one independent image block. Sequential blocks share this booted worker. */
  runImageBlock(input: DirectorImageRunInput): Promise<DirectorDone> {
    if (this.#disposed || !this.#worker) {
      return Promise.reject(new BrowserRenderError('disposed', 'The render session is disposed'));
    }
    if (!this.#engineReceived) {
      return Promise.reject(new BrowserRenderError('engine', 'The engine is not ready'));
    }
    if (this.#imageRun) {
      return Promise.reject(
        new BrowserRenderError('protocol', 'An image block is already running'),
      );
    }
    if (this.#runDispatched || this.#runFinished) {
      return Promise.reject(
        new BrowserRenderError('protocol', 'This render worker already ran a video scene'),
      );
    }
    const runId = randomId();
    const runToken = randomToken();
    const promise = new Promise<DirectorDone>((resolve, reject) => {
      this.#imageRun = { runId, runToken, resolve, reject };
    });
    const command: WorkerCommand = {
      v: WORKER_PROTOCOL_VERSION,
      type: 'run',
      bootId: this.#bootId,
      sessionId: this.#sessionId,
      runId,
      runToken,
      mode: 'image',
      source: input.source,
      sceneName: input.sceneName,
      frameRate: input.frameRate,
      resolution: input.resolution,
      narration: null,
    };
    try {
      this.#worker.postMessage(command);
    } catch (error) {
      this.#imageRun = null;
      return Promise.reject(
        new BrowserRenderError('protocol', 'The image block command could not be posted', {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return promise;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const pending = this.#imageRun;
    this.#imageRun = null;
    pending?.reject(new BrowserRenderError('disposed', 'The render session is disposed'));
    const worker = this.#worker;
    this.#worker = null;
    if (worker) {
      try {
        worker.postMessage({
          v: WORKER_PROTOCOL_VERSION,
          type: 'dispose',
          sessionId: this.#sessionId,
        } satisfies WorkerCommand);
      } catch {
        // The worker may already be gone; termination below is the hard stop.
      }
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    if (this.#engineUrl) {
      URL.revokeObjectURL(this.#engineUrl);
      this.#engineUrl = null;
    }
  }

  #fail(error: BrowserRenderError): void {
    if (this.#disposed) return;
    this.#callbacks.onError(error);
    this.dispose();
  }

  #protocolError(reason: string): void {
    this.#fail(new BrowserRenderError('protocol', reason));
  }

  #receive(data: unknown): void {
    if (this.#disposed) return;
    if (!isRecord(data) || data.v !== WORKER_PROTOCOL_VERSION) {
      return;
    }
    if (data.type === 'engine') {
      // The engine handshake is accepted exactly once, before a run. A scene
      // cannot reach this point before its source is executed, and any later
      // engine message is a forged bootstrap: stop the worker rather than
      // importing its JavaScript.
      if (this.#engineReceived || this.#runDispatched) {
        this.#protocolError('A second engine handshake arrived after initialization');
        return;
      }
      const message = data as unknown as WorkerEngineMessage;
      if (message.bootId !== this.#bootId || message.bootToken !== this.#bootToken) {
        this.#protocolError('The engine handshake did not match this boot');
        return;
      }
      if (
        typeof message.cjk !== 'boolean' ||
        !isRecord(message.engine) ||
        typeof message.engine.js !== 'string' ||
        message.engine.js.length === 0 ||
        message.engine.js.length > 16 * 1024 * 1024 ||
        !(message.engine.wasm instanceof Uint8Array) ||
        message.engine.wasm.byteLength === 0 ||
        message.engine.wasm.byteLength > 128 * 1024 * 1024 ||
        !Array.isArray(message.engine.fonts) ||
        message.engine.fonts.length === 0 ||
        message.engine.fonts.length > 8 ||
        message.engine.fonts.some(
          (font) => !(font instanceof Uint8Array) || font.byteLength > 64 * 1024 * 1024,
        )
      ) {
        this.#protocolError('The engine handshake payload is invalid');
        return;
      }
      if (!message.cjk) {
        this.#fail(
          new BrowserRenderError(
            'engine',
            'The engine started without CJK fonts; refusing to render Chinese content',
          ),
        );
        return;
      }
      this.#engineReceived = true;
      void this.#initializeEngine(message);
      return;
    }
    if (data.type === 'status') {
      const message = data as unknown as WorkerStatusMessage;
      if (
        message.bootId !== this.#bootId ||
        message.bootToken !== this.#bootToken ||
        typeof message.text !== 'string' ||
        message.text.length > 500
      ) {
        return;
      }
      if (!this.#engineReceived && !this.#disposed) this.#callbacks.onStatus(message.text);
      return;
    }
    if (data.type === 'boot-error') {
      const message = data as unknown as WorkerBootErrorMessage;
      if (
        message.bootId !== this.#bootId ||
        message.bootToken !== this.#bootToken ||
        this.#engineReceived
      ) {
        return;
      }
      this.#fail(toError(message.error, new BrowserRenderError('boot', 'ManimGX could not start')));
      return;
    }

    if (
      this.#imageRun &&
      (data.type === 'feed' || data.type === 'done' || data.type === 'error')
    ) {
      const run = this.#imageRun;
      if (data.type === 'feed') {
        const message = data as unknown as WorkerFeedMessage;
        if (
          message.sessionId !== this.#sessionId ||
          message.runId !== run.runId ||
          message.runToken !== run.runToken ||
          !(message.bytes instanceof ArrayBuffer) ||
          message.bytes.byteLength > MAX_FEED_BYTES
        ) {
          return;
        }
        this.#callbacks.onFeed(message.bytes);
        return;
      }
      if (data.type === 'done') {
        const message = data as unknown as WorkerDoneMessage;
        if (
          message.sessionId !== this.#sessionId ||
          message.runId !== run.runId ||
          message.runToken !== run.runToken
        ) {
          return;
        }
        const done = parseDirectorDone(message);
        if (!done) return;
        this.#imageRun = null;
        run.resolve(done);
        return;
      }
      const message = data as {
        sessionId?: unknown;
        runId?: unknown;
        runToken?: unknown;
        error?: unknown;
      };
      if (
        message.sessionId !== this.#sessionId ||
        message.runId !== run.runId ||
        message.runToken !== run.runToken
      ) {
        return;
      }
      this.#imageRun = null;
      const failure = toError(
        message.error,
        new BrowserRenderError('scene', 'The image block scene failed'),
      );
      run.reject(failure);
      this.#fail(failure);
      return;
    }

    if (!this.#runDispatched || this.#runFinished) return;
    if (data.type === 'feed') {
      const message = data as unknown as WorkerFeedMessage;
      if (
        message.sessionId !== this.#sessionId ||
        message.runId !== this.#runId ||
        message.runToken !== this.#runToken ||
        !(message.bytes instanceof ArrayBuffer) ||
        message.bytes.byteLength > MAX_FEED_BYTES
      ) {
        return;
      }
      this.#callbacks.onFeed(message.bytes);
      return;
    }
    if (data.type === 'done') {
      const message = data as unknown as WorkerDoneMessage;
      if (
        message.sessionId !== this.#sessionId ||
        message.runId !== this.#runId ||
        message.runToken !== this.#runToken
      ) {
        return;
      }
      const done = parseDirectorDone(message);
      if (!done) return;
      this.#runFinished = true;
      this.#callbacks.onDone(done);
      return;
    }
    if (data.type === 'error') {
      const message = data as {
        sessionId?: unknown;
        runId?: unknown;
        runToken?: unknown;
        error?: unknown;
      };
      if (
        message.sessionId !== this.#sessionId ||
        message.runId !== this.#runId ||
        message.runToken !== this.#runToken
      ) {
        return;
      }
      this.#runFinished = true;
      this.#fail(toError(message.error, new BrowserRenderError('scene', 'The scene failed')));
    }
  }

  async #initializeEngine(message: WorkerEngineMessage): Promise<void> {
    const local = this.#options.engineAssets;
    const js = local ? local.js : message.engine.js;
    const wasm = local ? new Uint8Array(local.wasm) : message.engine.wasm;
    const { fonts } = message.engine;
    const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    this.#engineUrl = url;
    try {
      const module = (await import(/* @vite-ignore */ url)) as ManimgxEngine;
      if (this.#disposed) return;
      await module.default({ module_or_path: wasm });
      if (this.#disposed) return;
      await module.init(fonts);
      if (this.#disposed) return;
      this.#callbacks.onEngine(module, message.cjk);
    } catch (error) {
      if (this.#disposed) return;
      this.#fail(
        new BrowserRenderError('engine', "ManimGX can't draw here", {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      URL.revokeObjectURL(url);
      if (this.#engineUrl === url) this.#engineUrl = null;
    }
  }
}
