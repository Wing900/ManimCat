/**
 * Public contract for the independent browser rendering runtime.
 *
 * This module deliberately knows nothing about the main application's settings,
 * jobs, API credentials or cloud renderer. The host hands it a self-contained
 * RenderSessionInput; the runtime renders it locally with WebGPU + Pyodide and
 * reports typed state back.
 */

export const BROWSER_RENDER_PROTOCOL_VERSION = 1 as const;

export const MIN_RENDER_WIDTH = 320;
export const MAX_RENDER_WIDTH = 3840;
export const MIN_RENDER_HEIGHT = 240;
export const MAX_RENDER_HEIGHT = 2160;
export const MIN_FRAME_RATE = 1;
export const MAX_FRAME_RATE = 120;
export const MAX_SOURCE_BYTES = 1024 * 1024;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const MAX_CUES = 4096;
export const MAX_SEGMENTS = 256;
export const MAX_SCENE_NAME_LENGTH = 200;
export const MAX_SESSION_ID_LENGTH = 128;

export interface RenderResolution {
  width: number;
  height: number;
}

/**
 * The portable subset of the native narration manifest. It intentionally has no
 * audioPath, no absolute filesystem path and no server credential. The audio
 * bytes travel beside it in RenderSessionInput.narration.audio.
 */
export interface PortableNarrationManifest {
  version: 1;
  duration: number;
  cues: Record<string, number>;
  segments?: PortableNarrationSegment[];
}

export interface PortableNarrationSegment {
  id: string;
  start: number;
  duration: number;
  cues?: Record<string, number>;
}

export type NarrationAudio = ArrayBuffer | Blob;

export interface RenderNarrationInput {
  manifest: PortableNarrationManifest;
  /** WAV bytes. The runtime rejects anything that is not a readable RIFF/WAVE file. */
  audio: NarrationAudio;
  /** Explicit for clarity and future formats; only wav is accepted today. */
  format: 'wav';
}

export interface RenderSessionInput {
  /** Opaque caller-owned id. Must match /^[A-Za-z0-9_-]{8,128}$/. */
  sessionId: string;
  /** Python source for a manimgx.Scene subclass. Executed only inside the isolated frame worker. */
  source: string;
  /** Optional scene class name. When absent the runtime uses MainScene or the sole scene class. */
  sceneName?: string;
  /** Integer frames per second used by the scene clock and the narration manifest. */
  frameRate: number;
  resolution: RenderResolution;
  /**
   * Narration is all-or-nothing. When present, a valid WAV and manifest must
   * reach the player as an audio track on the same clock. When absent, no audio
   * is attached and the session reports narration: "none".
   */
  narration?: RenderNarrationInput;
}

export type BrowserRenderErrorCode =
  | 'invalid-input'
  | 'unsupported'
  | 'renderer-origin'
  | 'frame-timeout'
  | 'protocol'
  | 'asset'
  | 'boot'
  | 'engine'
  | 'scene'
  | 'narration'
  | 'blank-frame'
  | 'timeout'
  | 'disposed'
  | 'internal';

export class BrowserRenderError extends Error {
  readonly code: BrowserRenderErrorCode;
  readonly detail: string | null;
  readonly line: number | null;

  constructor(
    code: BrowserRenderErrorCode,
    message: string,
    options: { detail?: string | null; line?: number | null; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'BrowserRenderError';
    this.code = code;
    this.detail = options.detail ?? null;
    this.line = options.line ?? null;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface SerializedBrowserRenderError {
  code: BrowserRenderErrorCode;
  message: string;
  detail: string | null;
  line: number | null;
}

export function serializeRenderError(error: BrowserRenderError): SerializedBrowserRenderError {
  return {
    code: error.code,
    message: error.message.slice(0, 2000),
    detail: error.detail === null ? null : error.detail.slice(0, 20_000),
    line: error.line,
  };
}

export function deserializeRenderError(error: SerializedBrowserRenderError): BrowserRenderError {
  return new BrowserRenderError(error.code, error.message, {
    detail: error.detail,
    line: error.line,
  });
}

export type RenderPhase =
  | 'idle'
  | 'checking'
  | 'loading'
  | 'rendering'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'error'
  | 'disposed';

export type NarrationStatus = 'none' | 'pending' | 'included' | 'error';

/**
 * Whether requested narration can sound without another frame-owned gesture.
 * A host playback message cannot grant cross-origin user activation.
 */
export type AudioGestureState = 'none' | 'locked' | 'ready';

export type VisualCheck = 'unverified' | 'nonblack' | 'black' | 'unavailable';

export type CjkStatus = 'unknown' | 'loaded' | 'missing';

export interface RenderSessionState {
  sessionId: string | null;
  phase: RenderPhase;
  /** The player exists and the scene finished; the clock is safe to move. */
  ready: boolean;
  /** The Python scene and its take are complete. */
  sceneComplete: boolean;
  playing: boolean;
  currentTime: number;
  /** Seconds of finished film. null before completion; never NaN. */
  duration: number | null;
  narration: NarrationStatus;
  /** Narration audio gesture state: locked until a trusted in-frame gesture. */
  audio: AudioGestureState;
  /** Human-readable loading/rendering status; null once ready or failed. */
  statusText: string | null;
  visualCheck: VisualCheck;
  cjk: CjkStatus;
  error: BrowserRenderError | null;
}

export function initialRenderState(): RenderSessionState {
  return {
    sessionId: null,
    phase: 'idle',
    ready: false,
    sceneComplete: false,
    playing: false,
    currentTime: 0,
    duration: null,
    narration: 'none',
    audio: 'none',
    statusText: null,
    visualCheck: 'unverified',
    cjk: 'unknown',
    error: null,
  };
}

export type BrowserRenderCapability =
  | {
      supported: true;
      adapter: {
        float32Blendable: true;
        depth32FloatStencil8: true;
      };
    }
  | {
      supported: false;
      reason:
        | 'insecure-context'
        | 'no-navigator-gpu'
        | 'no-adapter'
        | 'adapter-timeout'
        | 'missing-feature'
        | 'no-worker'
        | 'no-wasm';
      detail: string;
      missingFeatures?: string[];
    };

export interface BrowserRenderSessionOptions {
  /**
   * Absolute URL of the isolated /renderer frame route.
   * The host rejects a same-origin URL and, outside localhost, any non-HTTPS URL.
   */
  rendererUrl: string;
  frameReadyTimeoutMs?: number;
  bootTimeoutMs?: number;
  renderTimeoutMs?: number;
}

export interface BrowserRenderSessionSnapshot {
  state: RenderSessionState;
  rendererOrigin: string | null;
}

export const DEFAULT_FRAME_READY_TIMEOUT_MS = 15_000;
export const DEFAULT_BOOT_TIMEOUT_MS = 120_000;
export const DEFAULT_RENDER_TIMEOUT_MS = 15 * 60_000;

export const REQUIRED_WEBGPU_FEATURES = [
  'float32-blendable',
  'depth32float-stencil8',
] as const;

/** A single independent image-mode source block, ordered by its original index. */
export interface RenderImageBlockInput {
  index: number;
  source: string;
}

export const MAX_IMAGE_BLOCKS = 24;
export const MAX_IMAGE_BLOCK_BYTES = 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_PNG_BYTES = 32 * 1024 * 1024;
/** Upper bound for all encoded PNGs retained by one browser image session. */
export const MAX_IMAGE_PNG_TOTAL_BYTES = 128 * 1024 * 1024;

export interface RenderImageSessionInput {
  sessionId: string;
  /** Independent YON_IMAGE blocks, already sorted by index. */
  blocks: RenderImageBlockInput[];
  frameRate: number;
  resolution: RenderResolution;
}

/** A completed clean PNG block, transferred as bytes from the isolated frame. */
export interface RenderedImageBlock {
  index: number;
  width: number;
  height: number;
  bytes: ArrayBuffer;
}

export interface ImageRenderProgress {
  completed: number;
  total: number;
  /** The block being rendered, or the one just completed. */
  index: number;
  statusText: string | null;
}

export type BrowserImageEvent =
  | { type: 'progress'; progress: ImageRenderProgress }
  | { type: 'block'; block: RenderedImageBlock }
  | { type: 'complete'; count: number };
