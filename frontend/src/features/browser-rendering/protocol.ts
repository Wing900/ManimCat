import {
  BROWSER_RENDER_PROTOCOL_VERSION,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BLOCKS,
  MAX_IMAGE_BLOCK_BYTES,
  MAX_IMAGE_PNG_BYTES,
  MAX_IMAGE_TOTAL_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_SOURCE_BYTES,
  type AudioGestureState,
  type BrowserRenderErrorCode,
  type CjkStatus,
  type NarrationStatus,
  type PortableNarrationManifest,
  type RenderPhase,
  type RenderSessionState,
  type SerializedBrowserRenderError,
  deserializeRenderError,
  serializeRenderError,
  type VisualCheck,
} from './types';

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const PHASES: ReadonlySet<RenderPhase> = new Set([
  'idle',
  'checking',
  'loading',
  'rendering',
  'ready',
  'playing',
  'paused',
  'error',
  'disposed',
]);
const NARRATION: ReadonlySet<NarrationStatus> = new Set([
  'none',
  'pending',
  'included',
  'error',
]);
const VISUAL: ReadonlySet<VisualCheck> = new Set([
  'unverified',
  'nonblack',
  'black',
  'unavailable',
]);
const CJK: ReadonlySet<CjkStatus> = new Set(['unknown', 'loaded', 'missing']);
const AUDIO: ReadonlySet<AudioGestureState> = new Set(['none', 'locked', 'ready']);
const ERROR_CODES: ReadonlySet<BrowserRenderErrorCode> = new Set([
  'invalid-input',
  'unsupported',
  'renderer-origin',
  'frame-timeout',
  'protocol',
  'asset',
  'boot',
  'engine',
  'scene',
  'narration',
  'blank-frame',
  'timeout',
  'disposed',
  'internal',
]);
const MAX_ERROR_MESSAGE = 2000;
const MAX_ERROR_DETAIL = 20_000;
const MAX_SCENE_NAME = 200;

export interface SerializedStartInput {
  sessionId: string;
  source: string;
  sceneName: string | null;
  frameRate: number;
  resolution: { width: number; height: number };
  narration: {
    manifest: PortableNarrationManifest;
    audio: ArrayBuffer;
    format: 'wav';
  } | null;
}

export interface StartMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'session:start';
  sessionId: string;
  input: SerializedStartInput;
}

export interface SerializedImageStartInput {
  sessionId: string;
  blocks: Array<{ index: number; source: string }>;
  frameRate: number;
  resolution: { width: number; height: number };
}

export interface ImageStartMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'image:start';
  sessionId: string;
  input: SerializedImageStartInput;
}

export interface PlayMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'playback:play';
  sessionId: string;
}

export interface PauseMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'playback:pause';
  sessionId: string;
}

export interface SeekMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'playback:seek';
  sessionId: string;
  seconds: number;
}

export interface DisposeMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'session:dispose';
  sessionId: string;
}

export type ParentToFrame =
  | StartMessage
  | ImageStartMessage
  | PlayMessage
  | PauseMessage
  | SeekMessage
  | DisposeMessage;

export interface FrameReadyMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'frame:ready';
}

export type WireRenderSessionState = Omit<RenderSessionState, 'error'> & {
  error: SerializedBrowserRenderError | null;
};

export interface StateMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'session:state';
  sessionId: string;
  state: WireRenderSessionState;
}

export interface ProgressMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'session:progress';
  sessionId: string;
  currentTime: number;
  duration: number | null;
}

export interface CompleteMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'session:complete';
  sessionId: string;
  duration: number;
  narration: 'none' | 'included';
  visualCheck: VisualCheck;
  cjk: CjkStatus;
}

export interface ErrorMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'session:error';
  sessionId: string;
  error: SerializedBrowserRenderError;
}

export interface DisposedMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'session:disposed';
  sessionId: string;
}

export interface ImageProgressMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'image:progress';
  sessionId: string;
  completed: number;
  total: number;
  index: number;
  statusText: string | null;
}

export interface ImageBlockMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'image:block';
  sessionId: string;
  index: number;
  width: number;
  height: number;
  /** PNG bytes. The host owns the object URL created from them. */
  bytes: ArrayBuffer;
}

export interface ImageCompleteMessage {
  v: typeof BROWSER_RENDER_PROTOCOL_VERSION;
  type: 'image:complete';
  sessionId: string;
  count: number;
}

export type FrameToParent =
  | FrameReadyMessage
  | StateMessage
  | ProgressMessage
  | CompleteMessage
  | ErrorMessage
  | DisposedMessage
  | ImageProgressMessage
  | ImageBlockMessage
  | ImageCompleteMessage;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validSession(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isSerializedError(value: unknown): value is SerializedBrowserRenderError {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === 'string' &&
    ERROR_CODES.has(value.code as BrowserRenderErrorCode) &&
    boundedString(value.message, MAX_ERROR_MESSAGE) &&
    (value.detail === null || boundedString(value.detail, MAX_ERROR_DETAIL)) &&
    (value.line === null ||
      (typeof value.line === 'number' && Number.isInteger(value.line) && value.line >= 0))
  );
}

export function isRenderSessionState(value: unknown): value is WireRenderSessionState {
  if (!isRecord(value)) return false;
  return (
    (value.sessionId === null || validSession(value.sessionId)) &&
    typeof value.phase === 'string' &&
    PHASES.has(value.phase as RenderPhase) &&
    typeof value.ready === 'boolean' &&
    typeof value.sceneComplete === 'boolean' &&
    typeof value.playing === 'boolean' &&
    isFiniteNumber(value.currentTime) &&
    value.currentTime >= 0 &&
    value.currentTime <= 10_000_000 &&
    (value.duration === null ||
      (isFiniteNumber(value.duration) && value.duration >= 0)) &&
    typeof value.narration === 'string' &&
    NARRATION.has(value.narration as NarrationStatus) &&
    typeof value.audio === 'string' &&
    AUDIO.has(value.audio as AudioGestureState) &&
    (value.statusText === null ||
      (typeof value.statusText === 'string' && value.statusText.length <= 500)) &&
    typeof value.visualCheck === 'string' &&
    VISUAL.has(value.visualCheck as VisualCheck) &&
    typeof value.cjk === 'string' &&
    CJK.has(value.cjk as CjkStatus) &&
    (value.error === null || isSerializedError(value.error))
  );
}

export function toWireState(state: RenderSessionState): WireRenderSessionState {
  return {
    ...state,
    error: state.error ? serializeRenderError(state.error) : null,
  };
}

export function fromWireState(state: WireRenderSessionState): RenderSessionState {
  return {
    ...state,
    error: state.error ? deserializeRenderError(state.error) : null,
  };
}

function parseStartInput(value: unknown): SerializedStartInput | null {
  if (!isRecord(value)) return null;
  if (!validSession(value.sessionId)) return null;
  if (!boundedString(value.source, MAX_SOURCE_BYTES) || value.source.trim().length === 0) {
    return null;
  }
  if (
    value.sceneName !== null &&
    (!boundedString(value.sceneName, MAX_SCENE_NAME) || value.sceneName.length === 0)
  ) {
    return null;
  }
  if (
    typeof value.frameRate !== 'number' ||
    !Number.isInteger(value.frameRate) ||
    value.frameRate < 1 ||
    value.frameRate > 120
  ) {
    return null;
  }
  if (!isRecord(value.resolution)) return null;
  const width = value.resolution.width;
  const height = value.resolution.height;
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 8192 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 8192
  ) {
    return null;
  }
  let narration: SerializedStartInput['narration'] = null;
  if (value.narration !== null) {
    if (!isRecord(value.narration)) return null;
    if (value.narration.format !== 'wav') return null;
    if (!(value.narration.audio instanceof ArrayBuffer)) return null;
    if (value.narration.audio.byteLength <= 0 || value.narration.audio.byteLength > MAX_AUDIO_BYTES) {
      return null;
    }
    const manifest = value.narration.manifest;
    if (manifest !== null) {
      const size = (() => {
        try {
          return JSON.stringify(manifest).length;
        } catch {
          return Number.POSITIVE_INFINITY;
        }
      })();
      if (size > MAX_MANIFEST_BYTES) return null;
    }
    narration = {
      manifest: manifest as PortableNarrationManifest,
      audio: value.narration.audio,
      format: 'wav',
    };
  }
  return {
    sessionId: value.sessionId,
    source: value.source,
    sceneName: value.sceneName as string | null,
    frameRate: value.frameRate,
    resolution: { width, height },
    narration,
  };
}

function parseImageStartInput(value: unknown): SerializedImageStartInput | null {
  if (!isRecord(value)) return null;
  if (!validSession(value.sessionId)) return null;
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) return null;
  if (value.blocks.length > MAX_IMAGE_BLOCKS) return null;
  const seen = new Set<number>();
  const blocks: Array<{ index: number; source: string }> = [];
  let total = 0;
  for (const raw of value.blocks) {
    if (!isRecord(raw)) return null;
    if (
      typeof raw.index !== 'number' ||
      !Number.isSafeInteger(raw.index) ||
      raw.index < 0 ||
      raw.index > 999_999 ||
      seen.has(raw.index)
    ) {
      return null;
    }
    seen.add(raw.index);
    if (!boundedString(raw.source, MAX_IMAGE_BLOCK_BYTES) || raw.source.trim().length === 0) {
      return null;
    }
    total += new TextEncoder().encode(raw.source).byteLength;
    if (total > MAX_IMAGE_TOTAL_BYTES) return null;
    blocks.push({ index: raw.index, source: raw.source });
  }
  if (blocks.length > MAX_IMAGE_BLOCKS) return null;
  if (
    typeof value.frameRate !== 'number' ||
    !Number.isInteger(value.frameRate) ||
    value.frameRate < 1 ||
    value.frameRate > 120
  ) {
    return null;
  }
  if (!isRecord(value.resolution)) return null;
  const width = value.resolution.width;
  const height = value.resolution.height;
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 8192 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 8192
  ) {
    return null;
  }
  return {
    sessionId: value.sessionId,
    blocks,
    frameRate: value.frameRate,
    resolution: { width, height },
  };
}

export function parseParentMessage(data: unknown): ParseResult<ParentToFrame> {
  if (!isRecord(data)) return { ok: false, reason: 'message is not an object' };
  if (data.v !== BROWSER_RENDER_PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported protocol version' };
  }
  if (!validSession(data.sessionId)) return { ok: false, reason: 'invalid sessionId' };
  switch (data.type) {
    case 'session:start': {
      const input = parseStartInput(data.input);
      if (!input) return { ok: false, reason: 'invalid session input' };
      if (input.sessionId !== data.sessionId) {
        return { ok: false, reason: 'sessionId does not match input' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:start',
          sessionId: data.sessionId,
          input,
        },
      };
    }
    case 'image:start': {
      const input = parseImageStartInput(data.input);
      if (!input) return { ok: false, reason: 'invalid image session input' };
      if (input.sessionId !== data.sessionId) {
        return { ok: false, reason: 'sessionId does not match input' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'image:start',
          sessionId: data.sessionId,
          input,
        },
      };
    }
    case 'playback:play':
      return {
        ok: true,
        value: { v: BROWSER_RENDER_PROTOCOL_VERSION, type: 'playback:play', sessionId: data.sessionId },
      };
    case 'playback:pause':
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'playback:pause',
          sessionId: data.sessionId,
        },
      };
    case 'playback:seek':
      if (!isFiniteNumber(data.seconds) || data.seconds < 0 || data.seconds > 10_000_000) {
        return { ok: false, reason: 'invalid seek time' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'playback:seek',
          sessionId: data.sessionId,
          seconds: data.seconds,
        },
      };
    case 'session:dispose':
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:dispose',
          sessionId: data.sessionId,
        },
      };
    default:
      return { ok: false, reason: 'unknown message type' };
  }
}

export function parseFrameMessage(data: unknown): ParseResult<FrameToParent> {
  if (!isRecord(data)) return { ok: false, reason: 'message is not an object' };
  if (data.v !== BROWSER_RENDER_PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported protocol version' };
  }
  if (data.type === 'frame:ready') {
    return { ok: true, value: { v: BROWSER_RENDER_PROTOCOL_VERSION, type: 'frame:ready' } };
  }
  if (!validSession(data.sessionId)) return { ok: false, reason: 'invalid sessionId' };
  switch (data.type) {
    case 'session:state':
      if (!isRenderSessionState(data.state) || data.state.sessionId !== data.sessionId) {
        return { ok: false, reason: 'invalid state payload' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:state',
          sessionId: data.sessionId,
          state: data.state,
        },
      };
    case 'session:progress':
      if (
        !isFiniteNumber(data.currentTime) ||
        data.currentTime < 0 ||
        data.currentTime > 10_000_000 ||
        (data.duration !== null && (!isFiniteNumber(data.duration) || data.duration < 0))
      ) {
        return { ok: false, reason: 'invalid progress payload' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:progress',
          sessionId: data.sessionId,
          currentTime: data.currentTime,
          duration: data.duration,
        },
      };
    case 'session:complete':
      if (
        !isFiniteNumber(data.duration) ||
        data.duration <= 0 ||
        (data.narration !== 'none' && data.narration !== 'included') ||
        typeof data.visualCheck !== 'string' ||
        !VISUAL.has(data.visualCheck as VisualCheck) ||
        typeof data.cjk !== 'string' ||
        !CJK.has(data.cjk as CjkStatus)
      ) {
        return { ok: false, reason: 'invalid completion payload' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:complete',
          sessionId: data.sessionId,
          duration: data.duration,
          narration: data.narration as 'none' | 'included',
          visualCheck: data.visualCheck as VisualCheck,
          cjk: data.cjk as CjkStatus,
        },
      };
    case 'session:error':
      if (!isSerializedError(data.error)) return { ok: false, reason: 'invalid error payload' };
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:error',
          sessionId: data.sessionId,
          error: data.error,
        },
      };
    case 'session:disposed':
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:disposed',
          sessionId: data.sessionId,
        },
      };
    case 'image:progress':
      if (
        typeof data.completed !== 'number' ||
        !Number.isInteger(data.completed) ||
        data.completed < 0 ||
        data.completed > MAX_IMAGE_BLOCKS ||
        typeof data.total !== 'number' ||
        !Number.isInteger(data.total) ||
        data.total < 1 ||
        data.total > MAX_IMAGE_BLOCKS ||
        typeof data.index !== 'number' ||
        !Number.isSafeInteger(data.index) ||
        data.index < 0 ||
        (data.statusText !== null &&
          (typeof data.statusText !== 'string' || data.statusText.length > 500))
      ) {
        return { ok: false, reason: 'invalid image progress payload' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'image:progress',
          sessionId: data.sessionId,
          completed: data.completed,
          total: data.total,
          index: data.index,
          statusText: data.statusText as string | null,
        },
      };
    case 'image:block':
      if (
        typeof data.index !== 'number' ||
        !Number.isSafeInteger(data.index) ||
        data.index < 0 ||
        typeof data.width !== 'number' ||
        !Number.isInteger(data.width) ||
        data.width < 1 ||
        data.width > 8192 ||
        typeof data.height !== 'number' ||
        !Number.isInteger(data.height) ||
        data.height < 1 ||
        data.height > 8192 ||
        !(data.bytes instanceof ArrayBuffer) ||
        data.bytes.byteLength < 8 ||
        data.bytes.byteLength > MAX_IMAGE_PNG_BYTES
      ) {
        return { ok: false, reason: 'invalid image block payload' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'image:block',
          sessionId: data.sessionId,
          index: data.index,
          width: data.width,
          height: data.height,
          bytes: data.bytes,
        },
      };
    case 'image:complete':
      if (
        typeof data.count !== 'number' ||
        !Number.isInteger(data.count) ||
        data.count < 1 ||
        data.count > MAX_IMAGE_BLOCKS
      ) {
        return { ok: false, reason: 'invalid image completion payload' };
      }
      return {
        ok: true,
        value: {
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'image:complete',
          sessionId: data.sessionId,
          count: data.count,
        },
      };
    default:
      return { ok: false, reason: 'unknown message type' };
  }
}
