import { promises as fs, type Dirent } from 'fs'
import path from 'path'
import { createLogger } from '../utils/logger'

const logger = createLogger('MediaCleanup')

const DEFAULT_RETENTION_HOURS = 72
const DEFAULT_CLEANUP_INTERVAL_MINUTES = 60

interface CleanupSummary {
  removedFiles: number
  freedBytes: number
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.floor(value)
}

function getRetentionMs(): number {
  const hours = parsePositiveInteger(process.env.MEDIA_RETENTION_HOURS, DEFAULT_RETENTION_HOURS)
  return hours * 60 * 60 * 1000
}

function getCleanupIntervalMs(): number {
  const minutes = parsePositiveInteger(
    process.env.MEDIA_CLEANUP_INTERVAL_MINUTES,
    DEFAULT_CLEANUP_INTERVAL_MINUTES
  )
  return minutes * 60 * 1000
}

async function cleanupDirectory(
  dir: string,
  cutoffTime: number,
  extensions: string[]
): Promise<CleanupSummary> {
  let removedFiles = 0
  let freedBytes = 0

  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return { removedFiles, freedBytes }
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      const nested = await cleanupDirectory(fullPath, cutoffTime, extensions)
      removedFiles += nested.removedFiles
      freedBytes += nested.freedBytes
      continue
    }

    if (!extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      continue
    }

    try {
      const stat = await fs.stat(fullPath)
      if (stat.mtimeMs > cutoffTime) {
        continue
      }

      await fs.unlink(fullPath)
      removedFiles += 1
      freedBytes += stat.size
    } catch (error) {
      logger.warn('删除媒体文件失败', { file: fullPath, error: String(error) })
    }
  }

  return { removedFiles, freedBytes }
}

export async function cleanupExpiredMediaFiles(): Promise<{
  images: CleanupSummary
  videos: CleanupSummary
}> {
  const retentionMs = getRetentionMs()
  const cutoffTime = Date.now() - retentionMs

  const imagesDir = path.join(process.cwd(), 'public', 'images')
  const videosDir = path.join(process.cwd(), 'public', 'videos')

  const [images, videos] = await Promise.all([
    cleanupDirectory(imagesDir, cutoffTime, ['.png', '.jpg', '.jpeg', '.webp']),
    cleanupDirectory(videosDir, cutoffTime, ['.mp4'])
  ])

  if (images.removedFiles > 0 || videos.removedFiles > 0) {
    logger.info('媒体文件清理完成', {
      retentionHours: retentionMs / 1000 / 60 / 60,
      imagesRemoved: images.removedFiles,
      videosRemoved: videos.removedFiles,
      freedMB: Math.round((images.freedBytes + videos.freedBytes) / 1024 / 1024 * 100) / 100
    })
  }

  return { images, videos }
}

export function startMediaCleanupScheduler(): () => void {
  const intervalMs = getCleanupIntervalMs()

  cleanupExpiredMediaFiles().catch((error) => {
    logger.warn('启动时媒体清理失败', { error: String(error) })
  })

  const timer = setInterval(() => {
    cleanupExpiredMediaFiles().catch((error) => {
      logger.warn('周期媒体清理失败', { error: String(error) })
    })
  }, intervalMs)

  timer.unref()
  logger.info('媒体清理调度器已启动', {
    intervalMinutes: Math.round(intervalMs / 1000 / 60),
    retentionHours: Math.round(getRetentionMs() / 1000 / 60 / 60)
  })

  return () => clearInterval(timer)
}
