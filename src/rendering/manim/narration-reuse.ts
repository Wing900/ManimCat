/**
 * Server-owned narration sidecar for code re-renders.
 *
 * A quality change or a code-modal edit starts a *new* job id, so the run-scoped narration
 * workspace of the original job no longer applies. The voice track is still owned by this
 * renderCacheKey scope, so after a successful mux we publish one trusted copy under the
 * bucket and later runs read only that copy.
 *
 * No path from the browser is ever accepted here: the bucket is derived from the same
 * renderCacheKey the renderer already uses, and the published manifest is validated to live
 * inside that bucket before it is handed to the runtime.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../../shared/logging/logger'
import { resolveRenderCacheWorkspace } from '../../utils/render-cache-workspace'
import { resolveNarrationConfig } from './narration-mixer'
import type {
  NarrationAssets,
  NarrationConfig,
  NarrationManifest
} from '../../workflow/narration/types'

const logger = createLogger('NarrationReuse')

const STATE_FILENAME = 'narration-reuse.json'
const MANIFEST_FILENAME = 'narration-manifest.json'
const AUDIO_FILENAME = 'narration.wav'

interface NarrationReuseState {
  version: 1
  jobId: string
  renderCacheKey: string
  createdAt: string
  config: NarrationConfig
  assets: NarrationAssets
}

/** The same scope key renderVideo/narration workspaces use. */
export function narrationScopeKey(
  renderCacheKey: string | undefined,
  workspaceDirectory: string | undefined,
  jobId: string
): string {
  return renderCacheKey || workspaceDirectory || `job-${jobId}`
}

/**
 * `<render-cache>/<key>/video/narration-shared` — a sibling of every run subtree,
 * so a new job id can still find the voice for the same work.
 */
export function resolveNarrationSharedDirectory(renderCacheKey: string, jobId: string): string {
  const workspace = resolveRenderCacheWorkspace(renderCacheKey, 'video', jobId)
  return path.join(path.dirname(workspace.rootDir), 'narration-shared')
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function writeJsonAtomic(target: string, value: unknown): void {
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    fs.renameSync(temporary, target)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

function copyAtomic(source: string, target: string): void {
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  fs.copyFileSync(source, temporary)
  try {
    fs.renameSync(temporary, target)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

function readManifest(manifestPath: string): NarrationManifest {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as NarrationManifest
  if (manifest?.version !== 1 || !(manifest.duration > 0)) {
    throw new Error('Narration manifest is not a supported v1 manifest')
  }
  if (typeof manifest.audioPath !== 'string' || !manifest.audioPath) {
    throw new Error('Narration manifest has no audioPath')
  }
  return manifest
}

function rewriteManifest(
  sourceManifest: NarrationManifest,
  sharedDirectory: string
): NarrationManifest {
  const audioPath = path.join(sharedDirectory, AUDIO_FILENAME)
  const segments = Array.isArray(sourceManifest.segments) ? sourceManifest.segments : []
  const rewrittenSegments = segments.map((segment, index) => {
    const sourceSegment = segment.audioPath
    let targetSegment = segment.audioPath
    if (typeof sourceSegment === 'string' && sourceSegment) {
      const segmentDirectory = path.join(sharedDirectory, 'segments')
      fs.mkdirSync(segmentDirectory, { recursive: true })
      targetSegment = path.join(
        segmentDirectory,
        `${String(index).padStart(3, '0')}-${path.basename(sourceSegment)}`
      )
      if (fs.existsSync(sourceSegment)) {
        copyAtomic(sourceSegment, targetSegment)
      } else {
        targetSegment = sourceSegment
      }
    }
    return { ...segment, audioPath: path.resolve(targetSegment) }
  })
  return {
    ...sourceManifest,
    audioPath: path.resolve(audioPath),
    segments: rewrittenSegments
  }
}

/**
 * Copies the just-muxed narration into the bucket-owned sidecar. Best effort: a failure here
 * must never turn a successful render into a failed one.
 */
export function publishNarrationForReuse(options: {
  renderCacheKey: string
  jobId: string
  config: NarrationConfig
  assets: NarrationAssets
}): void {
  const { renderCacheKey, jobId, config, assets } = options
  try {
    if (!assets.manifestPath || !assets.audioPath || !fs.existsSync(assets.manifestPath)) {
      logger.warn('Narration assets are incomplete; nothing published for reuse', { jobId })
      return
    }
    const sharedDirectory = resolveNarrationSharedDirectory(renderCacheKey, jobId)
    // Already a published copy (quality change / code edit): do not copy it onto itself.
    if (isInside(sharedDirectory, assets.manifestPath)) {
      return
    }
    fs.mkdirSync(sharedDirectory, { recursive: true })
    const manifest = readManifest(assets.manifestPath)
    copyAtomic(assets.audioPath, path.join(sharedDirectory, AUDIO_FILENAME))
    const rewritten = rewriteManifest(manifest, sharedDirectory)
    const manifestPath = path.join(sharedDirectory, MANIFEST_FILENAME)
    writeJsonAtomic(manifestPath, rewritten)

    const state: NarrationReuseState = {
      version: 1,
      jobId,
      renderCacheKey,
      createdAt: new Date().toISOString(),
      config,
      assets: {
        manifestPath,
        audioPath: rewritten.audioPath,
        duration: rewritten.duration
      }
    }
    writeJsonAtomic(path.join(sharedDirectory, STATE_FILENAME), state)
    logger.info('Published narration for later re-renders', {
      jobId,
      manifestPath,
      duration: rewritten.duration
    })
  } catch (error) {
    logger.warn('Unable to publish narration for reuse', {
      jobId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * The one reuse decision both non-generating flows share (pre-generated code and AI edit).
 * Disabled narration, image mode, and a missing published sidecar all stay silent.
 */
export function resolveReusedNarrationForJob(args: {
  renderCacheKey: string | undefined
  workspaceDirectory: string | undefined
  jobId: string
  videoConfig: Parameters<typeof resolveNarrationConfig>[0]
  outputMode: 'video' | 'image'
}): NarrationAssets | undefined {
  if (!resolveNarrationConfig(args.videoConfig, args.outputMode)) {
    return undefined
  }
  return resolveReusedNarration(
    narrationScopeKey(args.renderCacheKey, args.workspaceDirectory, args.jobId),
    args.jobId
  )
}

/**
 * Returns the trusted published assets for this renderCacheKey, or undefined.
 *
 * Only the state file written by `publishNarrationForReuse` is considered. Its manifest and
 * audio must both sit inside the server-derived bucket; a stale or tampered pointer is ignored.
 */
export function resolveReusedNarration(
  renderCacheKey: string,
  jobId: string
): NarrationAssets | undefined {
  try {
    const sharedDirectory = resolveNarrationSharedDirectory(renderCacheKey, jobId)
    const statePath = path.join(sharedDirectory, STATE_FILENAME)
    if (!fs.existsSync(statePath)) {
      return undefined
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<NarrationReuseState>
    if (
      state.version !== 1 ||
      state.renderCacheKey !== renderCacheKey ||
      typeof state.jobId !== 'string' ||
      !state.jobId ||
      !state.assets
    ) {
      logger.warn('Ignoring invalid narration reuse state', { renderCacheKey, jobId })
      return undefined
    }
    const manifestPath = state.assets.manifestPath
    const audioPath = state.assets.audioPath
    if (
      typeof manifestPath !== 'string' ||
      typeof audioPath !== 'string' ||
      !isInside(sharedDirectory, manifestPath) ||
      !isInside(sharedDirectory, audioPath) ||
      !fs.existsSync(manifestPath) ||
      !fs.existsSync(audioPath)
    ) {
      logger.warn('Ignoring narration reuse state outside its bucket', { renderCacheKey, jobId })
      return undefined
    }
    const manifest = readManifest(manifestPath)
    if (!isInside(sharedDirectory, manifest.audioPath) || !fs.existsSync(manifest.audioPath)) {
      logger.warn('Narration reuse manifest points outside its bucket', { renderCacheKey, jobId })
      return undefined
    }
    logger.info('Reusing narration audio for re-render', {
      jobId,
      manifestPath,
      narrationJobId: state.jobId,
      duration: manifest.duration
    })
    return {
      manifestPath,
      audioPath: manifest.audioPath,
      duration: manifest.duration
    }
  } catch (error) {
    logger.warn('Unable to read narration reuse sidecar', {
      renderCacheKey,
      jobId,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}
