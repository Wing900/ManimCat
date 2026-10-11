import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

const RENDER_CACHE_ROOT = path.join(process.cwd(), '.studio-workspace', 'render-cache')

/**
 * Windows MAX_PATH, as this project actually meets it.
 *
 * The machines here run with `LongPathsEnabled = 0`, so 260 characters is a hard wall — and it is a
 * wall for **Python** specifically. manim pipes frames into ffmpeg (a native binary that copes with
 * long paths) and the partial movie files land on disk, then manim's own Python calls `os.utime` on
 * that same path and gets `FileNotFoundError: [WinError 3]` for a file that is demonstrably there.
 * The render then dies in `combine_to_movie()`, i.e. after every animation has played.
 *
 * Measured, not assumed: a 266-character path created through the `\\?\` API is reported as absent by
 * `os.path.exists` while `os.listdir` on its (231-character) parent lists it by name.
 *
 * So the two segments this module owns are kept short and, more importantly, **bounded**: a segment's
 * length no longer depends on how long the caller's key is. `slice(0, 8)` on the readable head plus a
 * 12-character digest caps the bucket at 21, the run segment at 12, which leaves the whole composed
 * path around 190 characters with ~70 to spare for whatever manim appends.
 */
const WINDOWS_MAX_PATH = 260
const PATH_SAFETY_MARGIN = 5

/**
 * What manim appends below `mediaDir` for one partial movie file, worst case:
 * `\videos\scene\720p15\partial_movie_files\<SceneClassName>\<hash>.mp4` — ~91 characters with an
 * ordinary scene name and hash, budgeted at 120 to cover a long generated class name.
 */
export const MANIM_MEDIA_TAIL_BUDGET = 120

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

/**
 * Refuses a workspace that manim could not finish in.
 *
 * The failure this prevents is invisible at the point it happens: manim renders every animation, then
 * dies in `combine_to_movie()` with a `FileNotFoundError` naming a file that is right there on disk,
 * and the user is handed a traceback from a library they never heard of. Failing here instead names
 * the real problem at the start of the run.
 */
function assertPathFitsWindowsLimit(mediaDir: string): void {
  const ceiling = WINDOWS_MAX_PATH - PATH_SAFETY_MARGIN
  if (mediaDir.length + MANIM_MEDIA_TAIL_BUDGET > ceiling) {
    throw new Error(
      `render cache path would exceed the Windows path limit: ` +
        `${mediaDir.length} + ${MANIM_MEDIA_TAIL_BUDGET} (what manim appends) > ${ceiling}. ` +
        `Shorten the composed segments, not the caller's key. Path: ${mediaDir}`
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
