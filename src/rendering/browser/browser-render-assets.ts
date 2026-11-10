/**
 * Server-owned delivery assets for a browser-rendered job.
 *
 * The browser never receives a filesystem path. It receives a same-origin URL derived
 * from the job id and the SHA-256 of the exact published bytes; the route resolves the
 * file under this fixed root only after the existing job-access check has passed. This
 * keeps cross-user and traversal access out of the feature instead of inventing a
 * second authorization scheme.
 *
 * Narration is content-addressed and immutable. Publishing writes a complete temporary
 * file, fsyncs it, then hard-links it to its final name. The hard link either creates
 * the target atomically or fails with EEXIST; it never replaces an existing asset. Two
 * executions of the same job therefore cannot clobber the bytes referenced by the first
 * completed result, including on Windows (NTFS hard links).
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  browserPreparationFailure,
  BrowserRenderPreparationError,
} from './browser-render-errors'

export const MAX_BROWSER_RENDER_AUDIO_BYTES = 64 * 1024 * 1024

const BROWSER_RENDER_ASSET_ROOT = path.join(
  process.cwd(),
  '.studio-workspace',
  'browser-render-assets'
)
const SAFE_JOB_ID = /^[A-Za-z0-9-]{8,64}$/
const SAFE_SHA256 = /^[a-f0-9]{64}$/
const NARRATION_PREFIX = 'narration-'
const NARRATION_SUFFIX = '.wav'
const SAFE_ASSET_NAME = /^narration-[a-f0-9]{64}\.wav$/

function assertSafeJobId(jobId: string): string {
  if (!isSafeBrowserRenderJobId(jobId)) {
    throw new Error('Invalid job id for a browser render asset')
  }
  return jobId
}

export function isSafeBrowserRenderJobId(jobId: string): boolean {
  return SAFE_JOB_ID.test(jobId)
}

export function isSafeBrowserRenderNarrationSha256(value: unknown): value is string {
  return typeof value === 'string' && SAFE_SHA256.test(value)
}

export function isSafeBrowserRenderNarrationAssetName(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ASSET_NAME.test(value)
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Browser render asset path escaped its root')
  }
}

export function resolveBrowserRenderAssetDirectory(jobId: string): string {
  const safeJobId = assertSafeJobId(jobId)
  return path.join(BROWSER_RENDER_ASSET_ROOT, safeJobId)
}

export function browserRenderNarrationAssetName(sha256: string): string {
  if (!isSafeBrowserRenderNarrationSha256(sha256)) {
    throw new Error('Invalid narration asset digest')
  }
  return `${NARRATION_PREFIX}${sha256}${NARRATION_SUFFIX}`
}

export function resolveBrowserRenderNarrationPath(jobId: string, sha256: string): string {
  const directory = resolveBrowserRenderAssetDirectory(jobId)
  const file = path.join(directory, browserRenderNarrationAssetName(sha256))
  assertInside(directory, file)
  return file
}

export function browserRenderNarrationUrl(jobId: string, sha256: string): string {
  return `/api/jobs/${encodeURIComponent(assertSafeJobId(jobId))}/browser-assets/${browserRenderNarrationAssetName(sha256)}`
}

export interface PublishedBrowserRenderNarration {
  byteLength: number
  sha256: string
}

function readBoundedNarration(sourcePath: string): Buffer {
  let fd: number | undefined
  try {
    fd = fs.openSync(sourcePath, 'r')
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) {
      throw new BrowserRenderPreparationError(
        'narration-unavailable',
        'Narration audio is not a regular file'
      )
    }
    if (stat.size <= 0 || stat.size > MAX_BROWSER_RENDER_AUDIO_BYTES) {
      throw new BrowserRenderPreparationError(
        'narration-unavailable',
        `Narration audio must be between 1 and ${MAX_BROWSER_RENDER_AUDIO_BYTES} bytes for browser rendering`
      )
    }
    const bytes = Buffer.allocUnsafe(stat.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      const read = fs.readSync(fd, bytes, offset, bytes.byteLength - offset, null)
      if (read <= 0) {
        throw new BrowserRenderPreparationError(
          'narration-unavailable',
          'Narration audio ended before its declared size'
        )
      }
      offset += read
    }
    return bytes
  } catch (error) {
    if (error instanceof BrowserRenderPreparationError) throw error
    throw browserPreparationFailure(
      'narration-unavailable',
      'Narration audio could not be read for browser rendering',
      error,
      { operation: 'read-narration' }
    )
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // The read result is already complete or already failed.
      }
    }
  }
}

function writeAll(fd: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.byteLength) {
    const written = fs.writeSync(fd, bytes, offset, bytes.byteLength - offset)
    if (written <= 0) {
      throw new Error('Unable to write the browser narration asset')
    }
    offset += written
  }
}

function assertPublishedAsset(target: string, expectedSize: number): void {
  const stat = fs.statSync(target)
  if (!stat.isFile() || stat.size !== expectedSize) {
    throw new BrowserRenderPreparationError(
      'asset-storage',
      'The published browser narration asset is incomplete'
    )
  }
}

/**
 * Publishes the exact bytes read from the trusted narration WAV.
 *
 * The digest and size are derived from the same bounded buffer that is written, so a
 * concurrent change to the source cannot make the payload describe different bytes.
 * Returns the byte count and digest used in the result's asset identity.
 */
export function writeBrowserRenderNarration(
  jobId: string,
  sourcePath: string
): PublishedBrowserRenderNarration {
  const bytes = readBoundedNarration(sourcePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const directory = resolveBrowserRenderAssetDirectory(jobId)
  const target = resolveBrowserRenderNarrationPath(jobId, sha256)
  assertInside(directory, target)
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  )

  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporaryFd = fs.openSync(temporary, 'wx', 0o600)
    try {
      writeAll(temporaryFd, bytes)
      fs.fsyncSync(temporaryFd)
    } finally {
      fs.closeSync(temporaryFd)
    }
    try {
      // A hard link publishes the fully written file atomically and never replaces an
      // existing target. Distinct attempts get distinct content-addressed names.
      fs.linkSync(temporary, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      // Another attempt published the same bytes first, or a prior attempt already
      // published this content. The name is the digest; verify the complete size.
      assertPublishedAsset(target, bytes.byteLength)
    }
  } catch (error) {
    throw browserPreparationFailure(
      'asset-storage',
      'Narration audio could not be published for browser rendering',
      error,
      { operation: 'publish-narration' }
    )
  } finally {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // A leftover temporary file is unreachable by the asset route.
    }
  }

  return { byteLength: bytes.byteLength, sha256 }
}
