/**
 * Server-side preparation of the portable browser render payload.
 *
 * This is deliberately a preparation step, not a render: it never spawns Manim,
 * FFmpeg or a sandbox process. The worker still owns AI generation and narration;
 * the browser runtime owns pixels and playback. Cue timing keeps its native source
 * (the narration manifest) and is transferred without any filesystem location.
 */

import fs from 'node:fs'
import type { NarrationAssets, NarrationConfig } from '../../workflow/narration/types'
import type {
  BrowserRenderNarrationPayload,
  BrowserRenderPreparedPayload,
  OutputMode,
  PortableNarrationManifest,
  RenderTarget,
  VideoQuality,
} from '../../types'
import { parseImageCodeBlocks } from '../manim/image-code-blocks'
import { cleanManimCode } from '../../utils/manim-code-cleaner'
import { publishNarrationForReuse } from '../manim/narration-reuse'
import { createLogger } from '../../shared/logging/logger'
import {
  browserRenderNarrationUrl,
  writeBrowserRenderNarration,
} from './browser-render-assets'
import {
  browserPreparationFailure,
  BrowserRenderPreparationError,
} from './browser-render-errors'
import type { RenderResult } from '../queue/processors/steps/render-step-types'

const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_NARRATION_SECONDS = 60 * 60
const MAX_CUES = 4096
const MAX_SEGMENTS = 256
const MAX_CUE_ID_LENGTH = 128
const CUE_EPS = 1 / 1_000_000

const logger = createLogger('BrowserRenderStep')

const QUALITY_RESOLUTION: Record<VideoQuality, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
}

// Concept reference images remain AI input. A scene file that expects a local image/SVG
// file has no portable counterpart in this phase, so reject the obvious literal form
// instead of preparing a payload that could only fail (or, worse, appear successful).
const EXTERNAL_ASSET_REFERENCE =
  /\b(?:ImageMobject|SVGMobject)\s*\(\s*(?:r|u|f)?["'][^"'\n]+\.(?:png|jpe?g|webp|gif|svg|pdf)["']/i

const EXTERNAL_IMAGE_REFERENCE =
  /\bImage\.open\s*\(\s*(?:r|u|f)?["'][^"'\n]+\.(?:png|jpe?g|webp|gif)["']/i

interface PrepareBrowserRenderArgs {
  jobId: string
  concept: string
  quality: string
  outputMode: OutputMode
  renderTarget: RenderTarget | undefined
  codeResult: {
    code: string
    usedAI: boolean
    generationType: string
    narration?: NarrationAssets
  }
  sceneName?: string
  videoConfig?: { frameRate?: number; narration?: NarrationConfig }
  renderCacheKey?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

function normalizeQuality(value: string): VideoQuality {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
}

function normalizeFrameRate(value: number | undefined): number {
  if (value === undefined) return 60
  if (!Number.isInteger(value) || value < 1 || value > 120) {
    throw new Error('Browser render frame rate must be an integer between 1 and 120')
  }
  return value
}

function readCueMap(
  value: unknown,
  label: string,
  limitSeconds: number
): Record<string, number> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object of cue ids to seconds`)
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_CUES) {
    throw new Error(`${label} has more than ${MAX_CUES} cues`)
  }
  // Null prototype keeps ids such as "__proto__" as ordinary own cues.
  const cues = Object.create(null) as Record<string, number>
  for (const [id, raw] of entries) {
    if (id.length === 0 || id.length > MAX_CUE_ID_LENGTH) {
      throw new Error(`${label} contains an invalid cue id`)
    }
    const seconds = finite(raw, `${label}[${JSON.stringify(id)}]`)
    if (seconds < 0 || seconds > limitSeconds + CUE_EPS) {
      throw new Error(`${label}[${JSON.stringify(id)}] is outside its duration`)
    }
    cues[id] = seconds
  }
  return cues
}

function toPortableManifest(value: unknown): PortableNarrationManifest {
  if (!isRecord(value)) {
    throw new Error('Narration manifest is not an object')
  }
  if (value.version !== 1) {
    throw new Error('Narration manifest is not a supported v1 manifest')
  }
  const duration = finite(value.duration, 'Narration manifest duration')
  if (duration <= 0 || duration > MAX_NARRATION_SECONDS) {
    throw new Error('Narration manifest duration is outside the browser runtime limits')
  }
  const cues = readCueMap(value.cues, 'Narration manifest cues', duration)
  const manifest: PortableNarrationManifest = { version: 1, duration, cues }

  if (value.segments !== undefined) {
    if (!Array.isArray(value.segments)) {
      throw new Error('Narration manifest segments must be an array')
    }
    if (value.segments.length > MAX_SEGMENTS) {
      throw new Error(`Narration manifest has more than ${MAX_SEGMENTS} segments`)
    }
    const seen = new Set<string>()
    manifest.segments = value.segments.map((raw, index) => {
      if (!isRecord(raw)) {
        throw new Error(`Narration manifest segments[${index}] is not an object`)
      }
      if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > MAX_CUE_ID_LENGTH) {
        throw new Error(`Narration manifest segments[${index}].id is invalid`)
      }
      if (seen.has(raw.id)) {
        throw new Error(`Narration manifest contains duplicate segment id ${raw.id}`)
      }
      seen.add(raw.id)
      const start = finite(raw.start, `Narration manifest segments[${index}].start`)
      const segmentDuration = finite(
        raw.duration,
        `Narration manifest segments[${index}].duration`
      )
      if (start < 0 || segmentDuration < 0 || start + segmentDuration > duration + CUE_EPS) {
        throw new Error(`Narration manifest segments[${index}] is outside the audio duration`)
      }
      return {
        id: raw.id,
        start,
        duration: segmentDuration,
        ...(raw.cues === undefined
          ? {}
          : {
              cues: readCueMap(
                raw.cues,
                `Narration manifest segments[${index}].cues`,
                segmentDuration
              ),
            }),
      }
    })
  }
  return manifest
}

function readPortableManifest(manifestPath: string): PortableNarrationManifest {
  let stat: fs.Stats
  try {
    stat = fs.statSync(manifestPath)
  } catch (error) {
    throw browserPreparationFailure(
      'narration-unavailable',
      'Narration manifest is unavailable for browser rendering',
      error,
      { operation: 'manifest-stat' }
    )
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) {
    throw new BrowserRenderPreparationError(
      'narration-unavailable',
      'Narration manifest has an invalid size for browser rendering'
    )
  }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new BrowserRenderPreparationError(
        'narration-unavailable',
        'Narration manifest is not valid JSON',
        { cause: error }
      )
    }
    throw browserPreparationFailure(
      'narration-unavailable',
      'Narration manifest could not be read for browser rendering',
      error,
      { operation: 'manifest-read' }
    )
  }
  try {
    return toPortableManifest(raw)
  } catch (error) {
    if (error instanceof BrowserRenderPreparationError) throw error
    throw new BrowserRenderPreparationError(
      'narration-unavailable',
      error instanceof Error ? error.message : 'Narration manifest is invalid',
      { cause: error }
    )
  }
}

function buildNarrationPayload(
  jobId: string,
  assets: NarrationAssets
): BrowserRenderNarrationPayload {
  if (!assets.manifestPath || !assets.audioPath) {
    throw new BrowserRenderPreparationError(
      'narration-unavailable',
      'Narration assets are incomplete for browser rendering'
    )
  }
  const manifest = readPortableManifest(assets.manifestPath)
  const published = writeBrowserRenderNarration(jobId, assets.audioPath)
  return {
    manifest,
    audioUrl: browserRenderNarrationUrl(jobId, published.sha256),
    mimeType: 'audio/wav',
    byteLength: published.byteLength,
    sha256: published.sha256,
  }
}

function assertNoUnsupportedExternalAssets(source: string): void {
  if (EXTERNAL_ASSET_REFERENCE.test(source) || EXTERNAL_IMAGE_REFERENCE.test(source)) {
    throw new Error(
      '浏览器本地渲染不会传输外部场景资源文件；需要读取图片或 SVG 文件的场景请改用云端渲染。' +
        ' Browser local rendering does not transfer external scene asset files; use cloud rendering for such scenes.'
    )
  }
}

/**
 * Builds the typed "prepared" result. No videoUrl, hardsubUrl or native render is
 * produced; a browser job is complete only when this payload has been stored. The
 * client-side readiness state is separate and is never inferred from this record.
 */
export function prepareBrowserRenderResult(
  args: PrepareBrowserRenderArgs
): RenderResult {
  if (args.renderTarget !== 'browser') {
    throw new Error('Browser render preparation requires the browser render target')
  }

  const quality = normalizeQuality(args.quality)
  const frameRate = normalizeFrameRate(args.videoConfig?.frameRate)
  const resolution = QUALITY_RESOLUTION[quality]

  if (args.outputMode === 'image') {
    let blocks: Array<{ index: number; source: string }>
    try {
      blocks = parseImageCodeBlocks(args.codeResult.code).map((block) => {
        const cleaned = cleanManimCode(block.code)
        const source = cleaned.code
        if (source.trim().length === 0) {
          throw new Error(`Image block ${block.index} is empty after cleaning`)
        }
        if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
          throw new Error(
            `Image block ${block.index} exceeds ${MAX_SOURCE_BYTES} bytes and cannot be transferred`
          )
        }
        assertNoUnsupportedExternalAssets(source)
        return { index: block.index, source }
      })
    } catch (error) {
      if (error instanceof BrowserRenderPreparationError) throw error
      throw new BrowserRenderPreparationError(
        'invalid-source',
        error instanceof Error ? error.message : 'Image mode source is invalid',
        { cause: error }
      )
    }

    const browserRender: BrowserRenderPreparedPayload = {
      outputMode: 'image',
      blocks,
      frameRate,
      resolution,
      quality,
    }

    logger.info('Prepared browser image render payload', {
      jobId: args.jobId,
      renderTarget: 'browser',
      outputMode: 'image',
      blockCount: blocks.length,
      frameRate,
      width: resolution.width,
      height: resolution.height,
      sourceBytes: blocks.reduce((total, block) => total + Buffer.byteLength(block.source, 'utf8'), 0),
    })

    return {
      jobId: args.jobId,
      concept: args.concept,
      outputMode: 'image',
      // Keep the anchored image-mode source for edit/rerender; the cleaned per-block
      // sources travel separately in the browser payload.
      code: args.codeResult.code,
      codeLanguage: 'manim-python',
      usedAI: args.codeResult.usedAI,
      generationType: args.codeResult.generationType,
      quality,
      renderTarget: 'browser',
      browserRender,
    }
  }

  const cleaned = cleanManimCode(args.codeResult.code)
  const source = cleaned.code
  if (source.trim().length === 0) {
    throw new Error('Browser render source is empty')
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error(
      `Browser render source exceeds ${MAX_SOURCE_BYTES} bytes and cannot be transferred`
    )
  }
  assertNoUnsupportedExternalAssets(source)

  const sceneName =
    typeof args.sceneName === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,199}$/.test(args.sceneName)
      ? args.sceneName
      : undefined

  const narrationConfig = args.videoConfig?.narration
  const narrationEnabled = narrationConfig?.enabled === true
  if (narrationEnabled && !args.codeResult.narration) {
    logger.warn('Narration was requested but no narration assets are available for browser rendering', {
      jobId: args.jobId,
      generationType: args.codeResult.generationType,
    })
    throw new BrowserRenderPreparationError(
      'narration-unavailable',
      '旁白已开启，但浏览器渲染所需的旁白资源不可用。请重新生成。 Narration is enabled, but the browser render has no usable narration assets. Generate the video again.'
    )
  }

  let narration: BrowserRenderNarrationPayload | undefined
  if (narrationEnabled && args.codeResult.narration) {
    try {
      narration = buildNarrationPayload(args.jobId, args.codeResult.narration)
    } catch (error) {
      throw browserPreparationFailure(
        'narration-unavailable',
        'Narration could not be prepared for browser rendering',
        error,
        { jobId: args.jobId, operation: 'build-narration-payload' }
      )
    }
  }

  if (narration && narrationConfig && args.renderCacheKey) {
    publishNarrationForReuse({
      renderCacheKey: args.renderCacheKey,
      jobId: args.jobId,
      config: narrationConfig,
      assets: args.codeResult.narration!,
    })
  }

  const browserRender: BrowserRenderPreparedPayload = {
    outputMode: 'video',
    source,
    ...(sceneName ? { sceneName } : {}),
    frameRate,
    resolution,
    quality,
    ...(narration ? { narration } : {}),
  }

  logger.info('Prepared browser render payload', {
    jobId: args.jobId,
    renderTarget: 'browser',
    outputMode: 'video',
    frameRate,
    width: resolution.width,
    height: resolution.height,
    hasNarration: Boolean(narration),
    sourceBytes: Buffer.byteLength(source, 'utf8'),
  })

  return {
    jobId: args.jobId,
    concept: args.concept,
    outputMode: 'video',
    code: source,
    codeLanguage: 'manim-python',
    usedAI: args.codeResult.usedAI,
    generationType: args.codeResult.generationType,
    quality,
    renderTarget: 'browser',
    browserRender,
  }
}
