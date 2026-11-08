/**
 * On-demand hard-subtitle route.
 *
 * The static video is public and the job id is an unguessable UUID, so this route
 * deliberately skips access middleware: it only re-encodes a file the caller can
 * already download. Burning is serialized inside burnSubtitles().
 */

import express, { type Request, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { asyncHandler } from '../http/middleware/async-route'
import { burnSubtitles } from '../rendering/manim/hardsub'
import { createLogger } from '../shared/logging/logger'

const router = express.Router()
const logger = createLogger('HardsubRoute')
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function videosDirectory(): string {
  return path.join(process.cwd(), 'public', 'videos')
}

/**
 * POST /api/videos/:jobId/hardsub
 * Returns `{ url }` for the burned MP4, creating it on first request.
 */
router.post(
  '/videos/:jobId/hardsub',
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params
    if (!JOB_ID.test(jobId)) {
      return res.status(400).json({ error: '无效的任务 ID' })
    }

    const directory = videosDirectory()
    const videoBasename = `${jobId}.mp4`
    const subtitleBasename = `${jobId}.vtt`
    if (!fs.existsSync(path.join(directory, videoBasename))) {
      return res.status(404).json({ error: '视频不存在' })
    }
    if (!fs.existsSync(path.join(directory, subtitleBasename))) {
      return res.status(409).json({ error: '该视频没有字幕' })
    }

    try {
      const outputPath = await burnSubtitles({
        directory,
        videoBasename,
        subtitleBasename,
        outputBasename: `${jobId}-hardsub.mp4`
      })
      return res.json({ url: `/videos/${path.basename(outputPath)}` })
    } catch (error) {
      logger.error('Unable to burn subtitles on demand', {
        jobId,
        error: error instanceof Error ? error.message : String(error)
      })
      return res.status(500).json({ error: '字幕烧录失败' })
    }
  })
)

export default router
