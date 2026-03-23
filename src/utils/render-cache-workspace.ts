import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

const RENDER_CACHE_ROOT = path.join(process.cwd(), '.studio-workspace', 'render-cache')

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
    .slice(0, 48) || 'render-cache'
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 12)
  return `${readable}-${digest}`
}

function ensureWorkspace(rootDir: string): void {
  fs.mkdirSync(rootDir, { recursive: true })
}

export function resolveRenderCacheWorkspace(
  renderCacheKey: string,
  scope: 'video' | 'image',
  blockIndex?: number
): RenderCacheWorkspace {
  const directoryName = toDirectoryName(renderCacheKey)
  const scopeSuffix =
    scope === 'video'
      ? 'video'
      : `image-${String(blockIndex ?? 0).padStart(3, '0')}`
  const rootDir = path.join(RENDER_CACHE_ROOT, directoryName, scopeSuffix)
  const mediaDir = path.join(rootDir, 'media')
  const codeFile = path.join(rootDir, 'scene.py')

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
