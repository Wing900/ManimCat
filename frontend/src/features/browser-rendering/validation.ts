import {
  BrowserRenderError,
  MAX_AUDIO_BYTES,
  MAX_CUES,
  MAX_FRAME_RATE,
  MAX_MANIFEST_BYTES,
  MAX_RENDER_HEIGHT,
  MAX_RENDER_WIDTH,
  MAX_SCENE_NAME_LENGTH,
  MAX_SEGMENTS,
  MAX_SESSION_ID_LENGTH,
  MAX_SOURCE_BYTES,
  MIN_FRAME_RATE,
  MIN_RENDER_HEIGHT,
  MIN_RENDER_WIDTH,
  type PortableNarrationManifest,
  type PortableNarrationSegment,
  type RenderNarrationInput,
  type RenderResolution,
  type RenderSessionInput,
} from './types';

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SCENE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,199}$/;
const MAX_NARRATION_SECONDS = 60 * 60;
const MAX_CUE_ID_LENGTH = 128;

// These mirror the native ManimCat narration runtime and the worker-side attach check.
// Keep them in sync with src/rendering/manim/narration_runtime.py and director.worker.ts.
const NARRATION_DURATION_TOLERANCE = 0.25;
const NARRATION_CUE_EPS = 1 / 1_000_000;
const MAX_NARRATION_DECODE_MS = 15_000;

export interface NormalizedNarration {
  manifest: PortableNarrationManifest;
  audio: ArrayBuffer;
  format: 'wav';
}

export interface NormalizedSessionInput {
  sessionId: string;
  source: string;
  sceneName: string | null;
  frameRate: number;
  resolution: RenderResolution;
  narration: NormalizedNarration | null;
}

export interface WavInfo {
  audioFormat: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  byteRate: number;
  dataBytes: number;
  duration: number;
}

function invalid(message: string, detail?: string): BrowserRenderError {
  return new BrowserRenderError('invalid-input', message, { detail });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${label} must be a finite number`);
  }
  return value;
}

function nonNegative(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number < 0) throw invalid(`${label} must not be negative`);
  return number;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Convert a public Blob/ArrayBuffer narration track into transferable bytes. */
export async function resolveNarrationAudio(
  narration: RenderNarrationInput | undefined,
): Promise<ArrayBuffer | null> {
  if (!narration) return null;
  if (narration.format !== 'wav') {
    throw invalid('Only WAV narration audio is supported');
  }
  let bytes: ArrayBuffer;
  if (narration.audio instanceof ArrayBuffer) {
    try {
      bytes = narration.audio.slice(0);
    } catch (error) {
      throw new BrowserRenderError('invalid-input', 'Narration audio could not be read', {
        detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : null,
        cause: error,
      });
    }
  } else if (typeof Blob !== 'undefined' && narration.audio instanceof Blob) {
    if (narration.audio.size <= 0) throw invalid('Narration audio is empty');
    if (narration.audio.size > MAX_AUDIO_BYTES) {
      throw invalid(`Narration audio exceeds ${MAX_AUDIO_BYTES} bytes`);
    }
    try {
      bytes = await narration.audio.arrayBuffer();
    } catch (error) {
      throw new BrowserRenderError('invalid-input', 'Narration audio could not be read', {
        detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : null,
        cause: error,
      });
    }
  } else {
    throw invalid('Narration audio must be an ArrayBuffer or Blob');
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
    throw invalid(`Narration audio must be between 1 and ${MAX_AUDIO_BYTES} bytes`);
  }
  return bytes;
}

function copyCues(
  value: unknown,
  label: string,
  limitSeconds: number,
): Record<string, number> {
  if (!isRecord(value)) throw invalid(`${label} must be an object of cue id -> seconds`);
  const entries = Object.entries(value);
  if (entries.length > MAX_CUES) {
    throw invalid(`${label} has more than ${MAX_CUES} cues`);
  }
  // A null prototype keeps ids such as "__proto__" as ordinary own cues instead of
  // invoking Object.prototype's setter and silently dropping the cue.
  const result = Object.create(null) as Record<string, number>;
  const limit = limitSeconds + NARRATION_CUE_EPS;
  for (const [id, raw] of entries) {
    if (id.length === 0 || id.length > MAX_CUE_ID_LENGTH) {
      throw invalid(`${label} has an invalid cue id`);
    }
    const seconds = finite(raw, `${label}[${JSON.stringify(id)}]`);
    if (seconds < 0 || seconds > limit) {
      throw invalid(`${label}[${JSON.stringify(id)}] is outside its allowed duration`);
    }
    result[id] = seconds;
  }
  return result;
}

function copySegments(
  value: unknown,
  duration: number,
): PortableNarrationSegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalid('narration.manifest.segments must be an array');
  if (value.length > MAX_SEGMENTS) {
    throw invalid(`narration.manifest.segments has more than ${MAX_SEGMENTS} entries`);
  }
  const seen = new Set<string>();
  const segments: PortableNarrationSegment[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) throw invalid(`narration.manifest.segments[${index}] must be an object`);
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_CUE_ID_LENGTH) {
      throw invalid(`narration.manifest.segments[${index}].id is invalid`);
    }
    if (seen.has(id)) throw invalid(`narration.manifest.segments contains duplicate id ${id}`);
    seen.add(id);
    const start = nonNegative(raw.start, `narration.manifest.segments[${index}].start`);
    const segmentDuration = nonNegative(
      raw.duration,
      `narration.manifest.segments[${index}].duration`,
    );
    if (start + segmentDuration > duration + NARRATION_CUE_EPS) {
      throw invalid(`narration.manifest.segments[${index}] ends past the audio duration`);
    }
    const segment: PortableNarrationSegment = { id, start, duration: segmentDuration };
    if (raw.cues !== undefined) {
      // Native segment cues are seconds relative to the segment's own duration.
      segment.cues = copyCues(
        raw.cues,
        `narration.manifest.segments[${index}].cues`,
        segmentDuration,
      );
    }
    segments.push(segment);
  }
  return segments;
}

function normalizeManifest(value: unknown, audioDuration: number): PortableNarrationManifest {
  if (!isRecord(value)) throw invalid('narration.manifest must be an object');
  if (value.version !== 1) throw invalid('narration.manifest.version must be 1');
  const duration = finite(value.duration, 'narration.manifest.duration');
  if (duration <= 0 || duration > MAX_NARRATION_SECONDS) {
    throw invalid(`narration.manifest.duration must be in (0, ${MAX_NARRATION_SECONDS}]`);
  }
  const cues = copyCues(value.cues, 'narration.manifest.cues', duration);
  const segments = copySegments(value.segments, duration);
  const manifest: PortableNarrationManifest = { version: 1, duration, cues };
  if (segments) manifest.segments = segments;
  if (Math.abs(audioDuration - duration) > NARRATION_DURATION_TOLERANCE) {
    throw invalid(
      `Narration audio is ${audioDuration.toFixed(3)}s but the manifest says ${duration.toFixed(3)}s`,
    );
  }
  return manifest;
}

/**
 * Validate a completed WAV file and return the timing information the runtime
 * needs to cross-check the portable manifest. This does not decode audio; the
 * ManimGX engine still decodes the bytes inside Pyodide.
 */
export function inspectWav(bytes: ArrayBuffer): WavInfo {
  const view = new DataView(bytes);
  if (view.byteLength < 44) throw invalid('Narration audio is not a complete WAV file');
  const tag = (offset: number): string =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw invalid('Narration audio must be a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt:
    | {
        audioFormat: number;
        channels: number;
        sampleRate: number;
        byteRate: number;
        blockAlign: number;
        bitsPerSample: number;
      }
    | undefined;
  let dataBytes = 0;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (size > view.byteLength - body) {
      throw invalid('Narration WAV contains a truncated chunk');
    }
    if (id === 'fmt ') {
      if (size < 16) throw invalid('Narration WAV has a short fmt chunk');
      const audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const byteRate = view.getUint32(body + 8, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      // Supported narration container: plain PCM or IEEE float. WAVE_FORMAT_EXTENSIBLE
      // (0xfffe) is rejected explicitly rather than guessing its SubFormat GUID; the
      // pinned native narration path emits plain 16-bit PCM, which every target browser
      // decodes. Float widths other than 32/64 are not valid IEEE-float WAV files.
      if (audioFormat === 0xfffe) {
        throw invalid(
          'Narration WAV uses WAVE_FORMAT_EXTENSIBLE, which this runtime does not support; use plain PCM',
        );
      }
      if (audioFormat !== 1 && audioFormat !== 3) {
        throw invalid('Narration WAV must contain PCM (format 1) or IEEE float (format 3) samples');
      }
      if (channels < 1 || channels > 8) throw invalid('Narration WAV has an invalid channel count');
      if (sampleRate < 8000 || sampleRate > 192000) {
        throw invalid('Narration WAV has an invalid sample rate');
      }
      const validWidth =
        audioFormat === 1
          ? [8, 16, 24, 32].includes(bitsPerSample)
          : [32, 64].includes(bitsPerSample);
      if (!validWidth) {
        throw invalid(
          audioFormat === 1
            ? 'Narration PCM WAV has an invalid sample width'
            : 'Narration float WAV must use 32- or 64-bit samples',
        );
      }
      const expectedBlockAlign = channels * (bitsPerSample / 8);
      if (blockAlign !== expectedBlockAlign) {
        throw invalid('Narration WAV blockAlign does not match its channels and sample width');
      }
      if (byteRate !== sampleRate * blockAlign) {
        throw invalid('Narration WAV byteRate does not match its sample rate and blockAlign');
      }
      fmt = { audioFormat, channels, sampleRate, byteRate, blockAlign, bitsPerSample };
    } else if (id === 'data') {
      dataBytes += size;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt) throw invalid('Narration WAV has no fmt chunk');
  if (dataBytes <= 0) throw invalid('Narration WAV has no audio samples');
  if (dataBytes % fmt.blockAlign !== 0) {
    throw invalid('Narration WAV data is not a whole number of sample frames');
  }
  const duration = dataBytes / fmt.byteRate;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw invalid('Narration WAV duration is invalid');
  }
  return {
    audioFormat: fmt.audioFormat,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    byteRate: fmt.byteRate,
    dataBytes,
    duration,
  };
}

/**
 * Validate and copy the public input. Only known fields survive; extra fields
 * (including anything resembling a server path or credential) are discarded.
 * The audio must already be an ArrayBuffer, so the result is transferable.
 */
export function normalizeSessionInput(
  input: RenderSessionInput,
  audio: ArrayBuffer | null,
): NormalizedSessionInput {
  if (!isRecord(input)) throw invalid('RenderSessionInput must be an object');
  const sessionId = input.sessionId;
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    throw invalid(
      `sessionId must match ${SESSION_ID.source} and be at most ${MAX_SESSION_ID_LENGTH} characters`,
    );
  }
  if (typeof input.source !== 'string' || input.source.trim().length === 0) {
    throw invalid('source must be a non-empty Python source string');
  }
  if (byteLength(input.source) > MAX_SOURCE_BYTES) {
    throw invalid(`source exceeds ${MAX_SOURCE_BYTES} UTF-8 bytes`);
  }
  let sceneName: string | null = null;
  if (input.sceneName !== undefined) {
    if (typeof input.sceneName !== 'string' || !SCENE_NAME.test(input.sceneName)) {
      throw invalid(
        `sceneName must be a Python identifier of at most ${MAX_SCENE_NAME_LENGTH} characters`,
      );
    }
    sceneName = input.sceneName;
  }
  if (
    typeof input.frameRate !== 'number' ||
    !Number.isInteger(input.frameRate) ||
    input.frameRate < MIN_FRAME_RATE ||
    input.frameRate > MAX_FRAME_RATE
  ) {
    throw invalid(`frameRate must be an integer in [${MIN_FRAME_RATE}, ${MAX_FRAME_RATE}]`);
  }
  if (!isRecord(input.resolution)) throw invalid('resolution must be an object');
  const width = input.resolution.width;
  const height = input.resolution.height;
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < MIN_RENDER_WIDTH ||
    width > MAX_RENDER_WIDTH
  ) {
    throw invalid(`resolution.width must be an integer in [${MIN_RENDER_WIDTH}, ${MAX_RENDER_WIDTH}]`);
  }
  if (
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < MIN_RENDER_HEIGHT ||
    height > MAX_RENDER_HEIGHT
  ) {
    throw invalid(
      `resolution.height must be an integer in [${MIN_RENDER_HEIGHT}, ${MAX_RENDER_HEIGHT}]`,
    );
  }

  let narration: NormalizedNarration | null = null;
  if (input.narration !== undefined) {
    if (!isRecord(input.narration)) throw invalid('narration must be an object');
    if (input.narration.format !== 'wav') throw invalid('narration.format must be "wav"');
    if (!(audio instanceof ArrayBuffer) || audio.byteLength === 0) {
      throw invalid('narration.audio must be non-empty WAV bytes');
    }
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw invalid(`narration.audio exceeds ${MAX_AUDIO_BYTES} bytes`);
    }
    let manifestJson: string;
    try {
      manifestJson = JSON.stringify(input.narration.manifest);
    } catch (error) {
      throw new BrowserRenderError('invalid-input', 'narration.manifest cannot be serialized', {
        detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : null,
        cause: error,
      });
    }
    const manifestBytes = byteLength(manifestJson);
    if (manifestBytes > MAX_MANIFEST_BYTES) {
      throw invalid(`narration.manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    const wav = inspectWav(audio);
    const manifest = normalizeManifest(input.narration.manifest, wav.duration);
    narration = { manifest, audio, format: 'wav' };
  } else if (audio !== null) {
    throw invalid('narration audio was supplied without a narration manifest');
  }

  return {
    sessionId,
    source: input.source,
    sceneName,
    frameRate: input.frameRate,
    resolution: { width, height },
    narration,
  };
}

/**
 * Decode the requested WAV in the frame with a bounded wait. The native Speaker does
 * not expose decode completion, so this is the frame-side proof that the bytes are
 * decodable; the take SOUND inspection in the controller covers the other side.
 */
export async function verifyNarrationDecodes(
  bytes: ArrayBuffer,
  expectedDuration: number,
): Promise<number> {
  const Offline = globalThis.OfflineAudioContext;
  if (typeof Offline !== 'function') {
    throw new BrowserRenderError(
      'narration',
      'This browser has no Web Audio decoder to verify the narration WAV',
    );
  }
  let context: OfflineAudioContext | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    context = new Offline(1, 1, 48_000);
    const decode = context.decodeAudioData(bytes.slice(0));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new BrowserRenderError('narration', 'Narration WAV decoding exceeded its time budget'),
        );
      }, MAX_NARRATION_DECODE_MS);
    });
    const decoded = await Promise.race([decode, timeout]);
    if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      throw new BrowserRenderError('narration', 'Narration WAV decoded to an invalid duration');
    }
    if (Math.abs(decoded.duration - expectedDuration) > NARRATION_DURATION_TOLERANCE) {
      throw new BrowserRenderError(
        'narration',
        'Decoded narration duration disagrees with the manifest',
        {
          detail: `decoded ${decoded.duration.toFixed(3)}s, manifest ${expectedDuration.toFixed(3)}s`,
        },
      );
    }
    return decoded.duration;
  } catch (error) {
    if (error instanceof BrowserRenderError) throw error;
    throw new BrowserRenderError('narration', 'Narration WAV could not be decoded in this browser', {
      detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : null,
      cause: error,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    const closeable = context as (OfflineAudioContext & { close?: () => Promise<void> }) | null;
    if (closeable?.close) void closeable.close().catch(() => undefined);
  }
}

/** Validate the portable manifest alone (used by the frame after postMessage). */
export function normalizeNarration(
  manifest: unknown,
  audio: ArrayBuffer | null,
): NormalizedNarration | null {
  if (manifest === null || manifest === undefined) {
    if (audio !== null) throw invalid('Narration audio arrived without a manifest');
    return null;
  }
  if (!(audio instanceof ArrayBuffer) || audio.byteLength === 0) {
    throw invalid('Narration manifest arrived without WAV audio');
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw invalid(`narration.audio exceeds ${MAX_AUDIO_BYTES} bytes`);
  }
  const wav = inspectWav(audio);
  const result = normalizeManifest(manifest, wav.duration);
  return { manifest: result, audio, format: 'wav' };
}

export interface NormalizedImageSessionInput {
  sessionId: string;
  blocks: Array<{ index: number; source: string }>;
  frameRate: number;
  resolution: RenderResolution;
}

/**
 * Validate an image-mode session: one or more independent blocks, unique finite
 * indexes, bounded source bytes and the same frame-rate/resolution limits as video.
 * The server has already parsed the YON_IMAGE anchors; this is the trust boundary for
 * anything entering the isolated frame.
 */
export function normalizeImageSessionInput(
  input: {
    sessionId: string;
    blocks: Array<{ index: number; source: string }>;
    frameRate: number;
    resolution: RenderResolution;
  },
  maxBlocks: number,
): NormalizedImageSessionInput {
  if (!SESSION_ID.test(input.sessionId)) {
    throw invalid('sessionId is invalid');
  }
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    throw invalid('image session needs at least one source block');
  }
  if (input.blocks.length > maxBlocks) {
    throw invalid(`image session has more than ${maxBlocks} source blocks`);
  }
  const seen = new Set<number>();
  const blocks: Array<{ index: number; source: string }> = [];
  let total = 0;
  for (const [position, block] of input.blocks.entries()) {
    if (!block || typeof block !== 'object') {
      throw invalid(`image block ${position} is invalid`);
    }
    if (
      typeof block.index !== 'number' ||
      !Number.isSafeInteger(block.index) ||
      block.index < 0 ||
      block.index > 999_999
    ) {
      throw invalid(`image block ${position} has an invalid index`);
    }
    if (seen.has(block.index)) {
      throw invalid(`image block index ${block.index} is duplicated`);
    }
    seen.add(block.index);
    if (typeof block.source !== 'string' || block.source.trim().length === 0) {
      throw invalid(`image block ${position} is empty`);
    }
    const bytes = byteLength(block.source);
    if (bytes > 1024 * 1024) {
      throw invalid(`image block ${position} exceeds the source byte limit`);
    }
    total += bytes;
    blocks.push({ index: block.index, source: block.source });
  }
  if (total > 4 * 1024 * 1024) {
    throw invalid('image session source exceeds the total byte limit');
  }
  const frameRate = finite(input.frameRate, 'frameRate');
  if (!Number.isInteger(frameRate) || frameRate < MIN_FRAME_RATE || frameRate > MAX_FRAME_RATE) {
    throw invalid(`frameRate must be an integer between ${MIN_FRAME_RATE} and ${MAX_FRAME_RATE}`);
  }
  const resolution = input.resolution;
  if (!resolution || typeof resolution !== 'object') {
    throw invalid('resolution is invalid');
  }
  const width = finite(resolution.width, 'resolution.width');
  const height = finite(resolution.height, 'resolution.height');
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < MIN_RENDER_WIDTH ||
    width > MAX_RENDER_WIDTH ||
    height < MIN_RENDER_HEIGHT ||
    height > MAX_RENDER_HEIGHT
  ) {
    throw invalid('resolution is outside the renderer limits');
  }
  blocks.sort((a, b) => a.index - b.index);
  return {
    sessionId: input.sessionId,
    blocks,
    frameRate,
    resolution: { width, height },
  };
}
