/**
 * 文件工具函数
 * 文件查找、路径处理
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * 获取质量对应的分辨率字符串
 */
export function getResolutionForQuality(quality: string): string {
  const resolutions: Record<string, string> = {
    low: '480p',
    medium: '720p',
    high: '1080p'
  }
  return resolutions[quality] || '480p'
}

/**
 * 查找视频文件
 * 支持动态帧率（如 480p15, 480p30, 1080p60 等）
 */
export function findVideoFile(mediaDir: string, quality: string, frameRate?: number): string | null {
  const resolution = getResolutionForQuality(quality)
  const expectedFrameRate = frameRate || 30

  // 首先尝试带帧率的文件夹（如 720p30）
  const folderWithFrameRate = `${resolution}${expectedFrameRate}`
  const expectedPath = path.join(mediaDir, 'videos', 'scene', folderWithFrameRate, 'MainScene.mp4')
  if (fs.existsSync(expectedPath)) {
    return expectedPath
  }

  // 递归搜索（fallback）
  return findFileRecursive(mediaDir, 'MainScene.mp4')
}

/**
 * 查找图片文件
 */
export function findImageFile(mediaDir: string, sceneName?: string): string | null {
  if (sceneName) {
    const sceneImage = findFileRecursive(mediaDir, `${sceneName}.png`)
    if (sceneImage) {
      return sceneImage
    }
  }

  return findFirstFileByExtension(mediaDir, '.png')
}

/**
 * 递归查找文件
 */
export function findFileRecursive(dir: string, filename: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename)
        if (found) return found
      } else if (entry.name === filename) {
        return fullPath
      }
    }
  } catch {
    // 忽略错误
  }

  return null
}

function findFirstFileByExtension(dir: string, ext: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = findFirstFileByExtension(fullPath, ext)
        if (found) return found
      } else if (entry.name.toLowerCase().endsWith(ext.toLowerCase())) {
        return fullPath
      }
    }
  } catch {
    // 忽略错误
  }

  return null
}
