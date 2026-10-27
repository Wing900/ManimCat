/**
 * Narration preparation: Edge TTS -> decoded WAV segments -> one exact track.
 *
 * Responsibilities kept on this side of the Python boundary:
 *   * validate the plan and cue markers;
 *   * strip markers before synthesis and remember their character positions;
 *   * cache per-segment audio (text + voice + rate) under the job's cache scope;
 *   * align Edge WordBoundary ticks to characters and map cues to real seconds;
 *   * concatenate decoded PCM by sample frames and build the manifest;
 *   * honour AbortSignal so a cancelled render kills the TTS child process.
 *
 * It never invents audio: an online failure or an unmappable cue is an error.
 */

import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '../../shared/logging/logger'
import {
  EDGE_TTS_TICKS_PER_SECOND,
  EDGE_TTS_WORKER_VERSION,
  NARRATION_CHANNELS,
  NARRATION_SAMPLE_RATE,
  runEdgeTtsWorker,
  type EdgeTtsSegmentResult
} from './edge-tts-client'
import { NarrationError, createCancellationError, throwIfCancelled } from './narration-error'
import {
  alignWordBoundaries,
  mapCueTimes,
  parseMarkedText,
  type EdgeWordBoundary,
  type ParsedSegmentText
} from './text-alignment'
import {
  concatWavFiles,
  copyFileAtomic,
  readWavInfo,
  replaceFileAtomic,
  type WavInfo
} from './wav-track'
import type {
  NarrationAssets,
  NarrationConfig,
  NarrationManifest,
  NarrationManifestSegment,
  NarrationPlan
} from './types'

const logger = createLogger('NarrationPrepare')

const CACHE_VERSION = 'narration-prepare-v1'
const SEGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const RATE_PATTERN = /^[+-]\d{1,3}%$/

export interface PrepareNarrationOptions {
  plan: NarrationPlan
  outputDirectory: string
  config: NarrationConfig
  signal?: AbortSignal
  /**
   * Optional backend-owned cache root. Defaults to a sibling of the narration
   * workspace so retries with the same renderCacheKey can reuse audio while a
   * failed-run cleanup of outputDirectory does not erase the cache.
   */
  cacheDirectory?: string
  /** 1..3; the Edge worker also clamps to its own cap. */
  concurrency?: number
  pythonPath?: string
  workerScriptPath?: string
  timeoutSeconds?: number
  ffmpegPath?: string
  ffprobePath?: string
}

interface PreparedSegment {
  id: string
  originalText: string
  parsed: ParsedSegmentText
  cacheKey: string
}

interface SegmentAudio {
  wavPath: string
  info: WavInfo
  boundaries: EdgeWordBoundary[]
}

interface CacheMetadata {
  version: string
  workerVersion: string
  key: string
  text: string
  voice: string
  rate: string
  sampleRate: number
  channels: number
  tickRate: number
  duration: number
  frames: number
  boundaries: EdgeWordBoundary[]
}

function roundSeconds(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function describeConfig(config: NarrationConfig): { voice: string; rate: string } {
  if (!config || config.enabled !== true) {
    throw new NarrationError(
      'NARRATION_DISABLED',
      'Narration is disabled; prepareNarration must not be called for this job'
    )
  }
  const voice = typeof config.voice === 'string' ? config.voice.trim() : ''
  if (!voice) {
    throw new NarrationError('INVALID_CONFIG', 'Narration voice must be a non-empty string')
  }
  const rawRate = typeof config.rate === 'string' ? config.rate.trim() : ''
  const normalizedRate = /^\d{1,3}%$/.test(rawRate) ? `+${rawRate}` : rawRate
  if (!RATE_PATTERN.test(normalizedRate)) {
    throw new NarrationError(
      'INVALID_CONFIG',
      `Narration rate must look like "+0%" or "-10%", got ${JSON.stringify(config.rate)}`,
      { rate: config.rate }
    )
  }
  return { voice, rate: normalizedRate }
}

function validateSegmentId(value: unknown, index: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NarrationError('INVALID_PLAN', `plan.segments[${index}].id must be a non-empty string`)
  }
  const id = value.trim()
  if (!SEGMENT_ID.test(id)) {
    throw new NarrationError(
      'INVALID_PLAN',
      `plan.segments[${index}].id must match [A-Za-z0-9][A-Za-z0-9_-]* (max 64 chars), got ${JSON.stringify(id)}`,
      { id }
    )
  }
  return id
}

function preparePlan(plan: NarrationPlan): PreparedSegment[] {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.segments) || plan.segments.length === 0) {
    throw new NarrationError('INVALID_PLAN', 'Narration plan must contain a non-empty segments array')
  }

  const seenSegments = new Set<string>()
  const seenCues = new Set<string>()
  const prepared: PreparedSegment[] = []

  for (let index = 0; index < plan.segments.length; index += 1) {
    const raw = plan.segments[index]
    if (!raw || typeof raw !== 'object') {
      throw new NarrationError('INVALID_PLAN', `plan.segments[${index}] must be an object`)
    }
    const id = validateSegmentId((raw as { id?: unknown }).id, index)
    if (seenSegments.has(id)) {
      throw new NarrationError('INVALID_PLAN', `Duplicate narration segment id ${JSON.stringify(id)}`, {
        id
      })
    }
    seenSegments.add(id)

    const text = (raw as { text?: unknown }).text
    if (typeof text !== 'string' || !text.trim()) {
      throw new NarrationError(
        'INVALID_PLAN',
        `plan.segments[${index}].text must be a non-empty string`,
        { id }
      )
    }

    const parsed = parseMarkedText(text, id)
    for (const marker of parsed.markers) {
      if (seenCues.has(marker.id)) {
        throw new NarrationError(
          'DUPLICATE_CUE',
          `Cue id ${JSON.stringify(marker.id)} appears more than once; manifest cue keys must be unique`,
          { id: marker.id, segmentId: id }
        )
      }
      seenCues.add(marker.id)
    }

    prepared.push({ id, originalText: text, parsed, cacheKey: '' })
  }

  return prepared
}

function segmentCacheKey(segment: PreparedSegment, voice: string, rate: string): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        version: CACHE_VERSION,
        workerVersion: EDGE_TTS_WORKER_VERSION,
        sampleRate: NARRATION_SAMPLE_RATE,
        channels: NARRATION_CHANNELS,
        voice,
        rate,
        text: segment.parsed.cleanText
      })
    )
    .digest('hex')
}

function safeSegmentFileName(index: number, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '') || 'segment'
  return `${String(index).padStart(3, '0')}-${safe.slice(0, 80)}.wav`
}

function validateCachedBoundaries(value: unknown): EdgeWordBoundary[] | undefined {
  if (!Array.isArray(value)) return undefined
  const boundaries: EdgeWordBoundary[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
    const record = item as { text?: unknown; offsetTicks?: unknown; durationTicks?: unknown }
    if (
      typeof record.text !== 'string' ||
      typeof record.offsetTicks !== 'number' ||
      !Number.isSafeInteger(record.offsetTicks) ||
      record.offsetTicks < 0 ||
      typeof record.durationTicks !== 'number' ||
      !Number.isSafeInteger(record.durationTicks) ||
      record.durationTicks < 0
    ) {
      return undefined
    }
    boundaries.push({
      text: record.text,
      offsetTicks: record.offsetTicks,
      durationTicks: record.durationTicks
    })
  }
  return boundaries
}

async function readCachedSegment(
  cacheRoot: string,
  cacheKey: string,
  segment: PreparedSegment,
  voice: string,
  rate: string
): Promise<SegmentAudio | undefined> {
  const wavPath = path.join(cacheRoot, 'segments', `${cacheKey}.wav`)
  const metaPath = path.join(cacheRoot, 'segments', `${cacheKey}.json`)
  try {
    const raw = await fsp.readFile(metaPath, 'utf8')
    const meta = JSON.parse(raw) as Partial<CacheMetadata>
    if (
      meta.version !== CACHE_VERSION ||
      meta.workerVersion !== EDGE_TTS_WORKER_VERSION ||
      meta.key !== cacheKey ||
      meta.text !== segment.parsed.cleanText ||
      meta.voice !== voice ||
      meta.rate !== rate ||
      meta.sampleRate !== NARRATION_SAMPLE_RATE ||
      meta.channels !== NARRATION_CHANNELS ||
      meta.tickRate !== EDGE_TTS_TICKS_PER_SECOND
    ) {
      return undefined
    }
    const boundaries = validateCachedBoundaries(meta.boundaries)
    if (!boundaries) return undefined
    if (
      typeof meta.frames !== 'number' ||
      !Number.isSafeInteger(meta.frames) ||
      meta.frames <= 0 ||
      typeof meta.duration !== 'number' ||
      !Number.isFinite(meta.duration) ||
      meta.duration <= 0
    ) {
      return undefined
    }
    const info = await readWavInfo(wavPath)
    if (
      info.frames !== meta.frames ||
      info.sampleRate !== NARRATION_SAMPLE_RATE ||
      info.channels !== NARRATION_CHANNELS ||
      info.bitsPerSample !== 16 ||
      Math.abs(info.duration - meta.duration) > 0.002
    ) {
      return undefined
    }
    return { wavPath, info, boundaries }
  } catch (error) {
    logger.debug('Narration cache miss', {
      segmentId: segment.id,
      cacheKey,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

async function writeCachedSegment(
  cacheRoot: string,
  cacheKey: string,
  segment: PreparedSegment,
  voice: string,
  rate: string,
  audio: SegmentAudio
): Promise<void> {
  if (process.env.NARRATION_DISABLE_CACHE === '1') {
    return
  }
  const cacheSegments = path.join(cacheRoot, 'segments')
  const wavPath = path.join(cacheSegments, `${cacheKey}.wav`)
  const metaPath = path.join(cacheSegments, `${cacheKey}.json`)
  try {
    await fsp.mkdir(cacheSegments, { recursive: true })
    await copyFileAtomic(audio.wavPath, wavPath)
    const meta: CacheMetadata = {
      version: CACHE_VERSION,
      workerVersion: EDGE_TTS_WORKER_VERSION,
      key: cacheKey,
      text: segment.parsed.cleanText,
      voice,
      rate,
      sampleRate: NARRATION_SAMPLE_RATE,
      channels: NARRATION_CHANNELS,
      tickRate: EDGE_TTS_TICKS_PER_SECOND,
      duration: audio.info.duration,
      frames: audio.info.frames,
      boundaries: audio.boundaries
    }
    const temp = `${metaPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
    await fsp.writeFile(temp, `${JSON.stringify(meta)}\n`, 'utf8')
    await replaceFileAtomic(temp, metaPath)
  } catch (error) {
    logger.warn('Unable to write narration cache entry', {
      segmentId: segment.id,
      cacheKey,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function ensureSegmentWav(source: string, target: string): Promise<string> {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  if (path.resolve(source) !== path.resolve(target)) {
    await copyFileAtomic(source, target)
  }
  return target
}

function buildManifest(params: {
  outputDirectory: string
  audioPath: string
  duration: number
  segments: PreparedSegment[]
  timings: Array<{ start: number; duration: number; path: string }>
  cueTimes: Array<Record<string, number>>
}): NarrationManifest {
  const { outputDirectory, audioPath, duration, segments, timings, cueTimes } = params
  const manifestSegments: NarrationManifestSegment[] = []
  const absoluteCues: Record<string, number> = {}

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const timing = timings[index]
    const relative = cueTimes[index]
    const segmentCues: Record<string, number> = {}
    for (const marker of segment.parsed.markers) {
      const relativeSeconds = roundSeconds(relative[marker.id])
      segmentCues[marker.id] = relativeSeconds
      const absolute = roundSeconds(timing.start + relativeSeconds)
      absoluteCues[marker.id] =
        absolute > duration ? roundSeconds(duration) : Math.max(0, absolute)
    }
    manifestSegments.push({
      id: segment.id,
      start: roundSeconds(timing.start),
      duration: roundSeconds(timing.duration),
      audioPath: path.resolve(outputDirectory, timing.path),
      cues: segmentCues
    })
  }

  return {
    version: 1,
    audioPath: path.resolve(audioPath),
    duration: roundSeconds(duration),
    segments: manifestSegments,
    cues: absoluteCues
  }
}

function defaultCacheRoot(outputDirectory: string): string {
  return path.join(path.dirname(outputDirectory), 'narration-cache')
}

/**
 * Generate the complete narration track and its timing manifest.
 *
 * The returned paths are absolute backend paths. The caller must not accept them
 * from the browser; this function derives everything from the plan + config.
 */
export async function prepareNarration(options: PrepareNarrationOptions): Promise<NarrationAssets> {
  throwIfCancelled(options.signal)
  const { voice, rate } = describeConfig(options.config)

  if (!options.outputDirectory || typeof options.outputDirectory !== 'string') {
    throw new NarrationError('INVALID_PLAN', 'outputDirectory must be a backend-resolved path')
  }
  const outputDirectory = path.resolve(options.outputDirectory)
  const segmentsDirectory = path.join(outputDirectory, 'segments')
  await fsp.mkdir(segmentsDirectory, { recursive: true })

  const segments = preparePlan(options.plan)
  for (const segment of segments) {
    segment.cacheKey = segmentCacheKey(segment, voice, rate)
  }

  const cacheRoot = path.resolve(
    options.cacheDirectory || process.env.NARRATION_CACHE_DIR || defaultCacheRoot(outputDirectory)
  )
  await fsp.mkdir(path.join(cacheRoot, 'segments'), { recursive: true }).catch(() => undefined)

  const totalCues = segments.reduce((total, segment) => total + segment.parsed.markers.length, 0)
  logger.info('Preparing narration', {
    segments: segments.length,
    cues: totalCues,
    voice,
    rate,
    outputDirectory,
    cacheRoot
  })

  // Cache lookup is deliberately per segment: changing one line only re-synthesizes
  // that segment, and a changed voice/rate invalidates every segment.
  const audioByIndex: Array<SegmentAudio | undefined> = new Array(segments.length)
  const cacheHits: number[] = []
  const misses: number[] = []
  for (let index = 0; index < segments.length; index += 1) {
    throwIfCancelled(options.signal)
    const cached = await readCachedSegment(
      cacheRoot,
      segments[index].cacheKey,
      segments[index],
      voice,
      rate
    )
    if (cached) {
      audioByIndex[index] = cached
      cacheHits.push(index)
    } else {
      misses.push(index)
    }
  }

  if (misses.length > 0) {
    throwIfCancelled(options.signal)
    const synthesized = await runEdgeTtsWorker({
      outputDirectory,
      segments: misses.map((index) => ({
        id: segments[index].id,
        text: segments[index].parsed.cleanText,
        voice,
        rate
      })),
      concurrency: options.concurrency,
      signal: options.signal,
      pythonPath: options.pythonPath,
      workerScriptPath: options.workerScriptPath,
      timeoutSeconds: options.timeoutSeconds,
      ffmpegPath: options.ffmpegPath,
      ffprobePath: options.ffprobePath
    })
    if (synthesized.length !== misses.length) {
      throw new NarrationError(
        'TTS_FAILED',
        `Edge TTS returned ${synthesized.length} segments for ${misses.length} requests`
      )
    }

    for (let offset = 0; offset < misses.length; offset += 1) {
      const index = misses[offset]
      const result: EdgeTtsSegmentResult = synthesized[offset]
      if (result.id !== segments[index].id) {
        throw new NarrationError(
          'TTS_FAILED',
          `Edge TTS result order mismatch: got ${result.id}, expected ${segments[index].id}`
        )
      }
      const info = await readWavInfo(result.wavPath)
      if (
        info.sampleRate !== NARRATION_SAMPLE_RATE ||
        info.channels !== NARRATION_CHANNELS ||
        info.bitsPerSample !== 16 ||
        info.frames <= 0
      ) {
        throw new NarrationError(
          'WAV_INVALID',
          `Synthesized WAV for ${segments[index].id} is not canonical 24kHz mono PCM16`,
          { segmentId: segments[index].id, info }
        )
      }
      if (Math.abs(info.duration - result.duration) > 0.01 || info.frames !== result.frames) {
        throw new NarrationError(
          'WAV_INVALID',
          `Synthesized WAV duration for ${segments[index].id} does not match worker metadata`,
          {
            segmentId: segments[index].id,
            wavDuration: info.duration,
            workerDuration: result.duration,
            wavFrames: info.frames,
            workerFrames: result.frames
          }
        )
      }
      audioByIndex[index] = {
        wavPath: result.wavPath,
        info,
        boundaries: result.boundaries
      }
      await writeCachedSegment(
        cacheRoot,
        segments[index].cacheKey,
        segments[index],
        voice,
        rate,
        audioByIndex[index]!
      )
    }
  }

  // Copy every segment into a stable, plan-ordered path. Cache hits and freshly
  // synthesized files then share one source of truth for concatenation.
  const canonicalPaths: string[] = []
  for (let index = 0; index < segments.length; index += 1) {
    throwIfCancelled(options.signal)
    const audio = audioByIndex[index]
    if (!audio) {
      throw new NarrationError('TTS_FAILED', `No audio produced for segment ${segments[index].id}`)
    }
    const target = path.join(segmentsDirectory, safeSegmentFileName(index, segments[index].id))
    const canonical = await ensureSegmentWav(audio.wavPath, target)
    const info = await readWavInfo(canonical)
    if (
      info.sampleRate !== NARRATION_SAMPLE_RATE ||
      info.channels !== NARRATION_CHANNELS ||
      info.bitsPerSample !== 16
    ) {
      throw new NarrationError(
        'WAV_INVALID',
        `Segment ${segments[index].id} is not canonical 24kHz mono PCM16`,
        { segmentId: segments[index].id, info }
      )
    }
    audioByIndex[index] = { wavPath: canonical, info, boundaries: audio.boundaries }
    canonicalPaths.push(canonical)
  }

  // Align words and map cues only after real durations are known.
  const cueTimes: Array<Record<string, number>> = []
  for (let index = 0; index < segments.length; index += 1) {
    throwIfCancelled(options.signal)
    const segment = segments[index]
    const audio = audioByIndex[index]!
    const { aligned, warnings } = alignWordBoundaries(segment.parsed.cleanText, audio.boundaries)
    if (warnings.length > 0) {
      logger.warn('Edge word boundaries did not align to spoken text', {
        segmentId: segment.id,
        warnings: warnings.slice(0, 8),
        totalWarnings: warnings.length,
        boundaries: audio.boundaries.length,
        aligned: aligned.length
      })
    }
    cueTimes.push(
      mapCueTimes(
        segment.parsed,
        aligned,
        audio.info.duration,
        segment.id,
        EDGE_TTS_TICKS_PER_SECOND
      )
    )
  }

  throwIfCancelled(options.signal)
  const audioPath = path.join(outputDirectory, 'narration.wav')
  const concatenated = await concatWavFiles(
    canonicalPaths.map((wavPath, index) => ({ path: wavPath, info: audioByIndex[index]!.info })),
    audioPath,
    { sampleRate: NARRATION_SAMPLE_RATE, channels: NARRATION_CHANNELS },
    options.signal
  )

  const manifest = buildManifest({
    outputDirectory,
    audioPath,
    duration: concatenated.duration,
    segments,
    timings: concatenated.segments,
    cueTimes
  })

  const manifestPath = path.join(outputDirectory, 'narration-manifest.json')
  const tempManifest = `${manifestPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  try {
    throwIfCancelled(options.signal)
    await fsp.writeFile(tempManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await replaceFileAtomic(tempManifest, manifestPath)
  } catch (error) {
    await fsp.rm(tempManifest, { force: true }).catch(() => undefined)
    if (options.signal?.aborted) {
      throw createCancellationError(options.signal)
    }
    throw error
  }

  logger.info('Narration track ready', {
    manifestPath,
    audioPath,
    duration: roundSeconds(concatenated.duration),
    segments: segments.length,
    cues: totalCues,
    cacheHits: cacheHits.length,
    synthesized: misses.length
  })

  return {
    manifestPath,
    audioPath,
    duration: roundSeconds(concatenated.duration)
  }
}
