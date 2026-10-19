import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

const RENDER_CACHE_ROOT = path.join(process.cwd(), '.studio-workspace', 'render-cache')

/** Bounded workspace names keep native rendering and Python paths within Windows MAX_PATH. */
const WINDOWS_MAX_PATH = 260
const PATH_SAFETY_MARGIN = 5

export interface RenderCacheWorkspace {
  key: string
  rootDir: string
  tempDir: string
  mediaDir: string
  codeFile: string
}

function normalizeRenderCacheKey(renderCacheKey: string): string {
  const trimmed = renderCacheKey.trim()
  if (!trimmed) {
    throw new Error('renderCacheKey must not be empty')
  }
  return trimmed
}

function toDirectoryName(renderCacheKey: string): string {
  const normalized = normalizeRenderCacheKey(renderCacheKey)
  const readable = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 8) || 'render-cache'
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 12)
  return `${readable}-${digest}`
}

/**
 * Turns one run id (a jobId for the classic queue, or a renderId for Studio) into a safe, unique
 * directory segment. Each run gets its own subtree so two jobs that happen to share a renderCacheKey
 * (e.g. a client reusing an explicit key, or two Studio runs on the same work id) can never overwrite
 * each other's `scene.py` or media outputs.
 *
 * Digest only, no readable head: a run id is already an opaque unique token, so spelling out its
 * first 32 characters bought nothing but 33 characters of path length in a place where the length is
 * what breaks (see `WINDOWS_MAX_PATH`).
 */
function toRunDirectoryName(runId: string): string {
  const normalized = runId.trim()
  if (!normalized) {
    throw new Error('runId must not be empty')
  }
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12)
}

function ensureWorkspace(rootDir: string): void {
  fs.mkdirSync(rootDir, { recursive: true })
}

/** GX writes a single declared artifact; CE's nested partial-movie paths are no longer used. */
function assertPathFitsWindowsLimit(mediaDir: string): void {
  if (process.platform !== 'win32') return
  const ceiling = WINDOWS_MAX_PATH - PATH_SAFETY_MARGIN
  const outputPath = path.join(mediaDir, 'output.mp4')
  if (outputPath.length > ceiling) {
    throw new Error(
      `Render output exceeds the Windows path limit (${ceiling} characters): ${outputPath}`
    )
  }
}

/**
 * Resolves a per-run render workspace.
 *
 * `renderCacheKey` names a shared cache bucket (by client / session / work id); `runId` names one
 * concrete execution (a jobId or a Studio renderId). The run subtree is always unique per run, so a
 * reused renderCacheKey can still benefit from staying under the same bucket without ever letting
 * two concurrent runs touch the same `scene.py` or `media/` directory.
 */
export function resolveRenderCacheWorkspace(
  renderCacheKey: string,
  scope: 'video' | 'image',
  runId: string,
  blockIndex?: number
): RenderCacheWorkspace {
  const directoryName = toDirectoryName(renderCacheKey)
  const scopeSuffix =
    scope === 'video'
      ? 'video'
      : `image-${String(blockIndex ?? 0).padStart(3, '0')}`
  const runSegment = toRunDirectoryName(runId)
  const rootDir = path.join(RENDER_CACHE_ROOT, directoryName, scopeSuffix, runSegment)
  const mediaDir = path.join(rootDir, 'media')
  const codeFile = path.join(rootDir, 'scene.py')

  assertPathFitsWindowsLimit(mediaDir)
  ensureWorkspace(mediaDir)

  return {
    key: renderCacheKey,
    rootDir,
    tempDir: rootDir,
    mediaDir,
    codeFile
  }
}

export function buildClassicRenderCacheKey(
  clientId: string | undefined,
  outputMode: 'video' | 'image',
  requestedKey?: string
): string {
  const normalizedRequested = requestedKey?.trim()
  if (normalizedRequested) {
    return normalizedRequested
  }

  const normalizedClientId = clientId?.trim() || 'anonymous'
  return `classic-${normalizedClientId}-${outputMode}`
}

export function buildStudioRenderCacheKey(
  sessionId: string,
  outputMode: 'video' | 'image',
  workId?: string
): string {
  const normalizedWorkId = workId?.trim()
  if (normalizedWorkId) {
    return `studio-${sessionId}-${outputMode}-${normalizedWorkId}`
  }
  return `studio-${sessionId}-${outputMode}`
}
