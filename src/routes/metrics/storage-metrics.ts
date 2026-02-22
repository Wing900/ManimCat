import { promises as fs, type Dirent } from 'fs'
import path from 'path'
import { redisClient } from '../../config/redis'
import { createLogger } from '../../utils/logger'

const logger = createLogger('StorageMetrics')

async function getDirectoryFileStats(
  dir: string,
  extensions: string[]
): Promise<{ count: number; totalBytes: number }> {
  let count = 0
  let totalBytes = 0

  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return { count, totalBytes }
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await getDirectoryFileStats(fullPath, extensions)
      count += nested.count
      totalBytes += nested.totalBytes
      continue
    }

    if (!extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      continue
    }

    try {
      const stat = await fs.stat(fullPath)
      count += 1
      totalBytes += stat.size
    } catch {
      // ignore stat errors
    }
  }

  return { count, totalBytes }
}

function formatSize(bytes: number) {
  return {
    bytes,
    mb: Math.round((bytes / 1024 / 1024) * 100) / 100,
    gb: Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100
  }
}

/**
 * 获取 Redis 内存信息
 */
export async function getRedisMemory() {
  try {
    const info = await redisClient.info('memory')
    const lines = info.split('\r\n')
    const memoryData: Record<string, string> = {}

    for (const line of lines) {
      const [key, value] = line.split(':')
      if (key && value) {
        memoryData[key] = value
      }
    }

    const usedMemory = parseInt(memoryData.used_memory || '0', 10)
    const peakMemory = parseInt(memoryData.used_memory_peak || '0', 10)

    return {
      used: {
        bytes: usedMemory,
        mb: Math.round((usedMemory / 1024 / 1024) * 100) / 100
      },
      peak: {
        bytes: peakMemory,
        mb: Math.round((peakMemory / 1024 / 1024) * 100) / 100
      },
      fragmentation: parseFloat(memoryData.mem_fragmentation_ratio || '0')
    }
  } catch (error) {
    logger.error('Failed to get Redis memory info', { error })
    return null
  }
}

/**
 * 获取磁盘使用情况
 */
export async function getDiskUsage() {
  try {
    const videosDir = path.join(process.cwd(), 'public', 'videos')
    const imagesDir = path.join(process.cwd(), 'public', 'images')

    const [videos, images] = await Promise.all([
      getDirectoryFileStats(videosDir, ['.mp4']),
      getDirectoryFileStats(imagesDir, ['.png', '.jpg', '.jpeg', '.webp'])
    ])

    return {
      videos: {
        count: videos.count,
        totalSize: formatSize(videos.totalBytes)
      },
      images: {
        count: images.count,
        totalSize: formatSize(images.totalBytes)
      }
    }
  } catch (error) {
    logger.error('Failed to get disk usage', { error })
    return null
  }
}
