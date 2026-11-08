import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../../shared/logging/logger'

const logger = createLogger('HardSubtitles')

/**
 * libass style used for burned captions. Colours are ASS `&HAABBGGRR`: opaque
 * black text with an opaque white outline, so it stays readable on light and
 * dark scenes. FontSize/MarginV are in script units; because ffmpeg feeds the
 * WebVTT through its own ASS conversion the result scales with the video height
 * (verified at 720p and 1080p), so one fixed value serves every quality.
 */
const FONT_FAMILY =
  process.env.HARDSUB_FONT?.trim() ||
  (process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC')

const FONT_SIZE = 18
const OUTLINE = 1.6
const MARGIN_V = 16

export function hardSubtitleStyle(): string {
  return [
    `FontName=${FONT_FAMILY}`,
    `FontSize=${FONT_SIZE}`,
    'PrimaryColour=&H00000000',
    'OutlineColour=&H00FFFFFF',
    `Outline=${OUTLINE}`,
    'Shadow=0',
    'Alignment=2',
    `MarginV=${MARGIN_V}`
  ].join(',')
}

export interface HardSubtitleArgsInput {
  /** Basenames: ffmpeg runs with the video directory as cwd, avoiding Windows drive-letter escaping. */
  inputBasename: string
  subtitleBasename: string
  outputBasename: string
}

/**
 * One re-encode that paints the VTT onto the picture and drops the container's
 * subtitle streams (keeping both would show burned text plus a soft overlay).
 */
export function buildHardSubtitleArgs(input: HardSubtitleArgsInput): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input.inputBasename,
    '-vf',
    `subtitles=${input.subtitleBasename}:force_style='${hardSubtitleStyle()}'`,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    input.outputBasename
  ]
}

function execFileAsync(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
      } else {
        resolve()
      }
    })
  })
}

/** One ffmpeg at a time: burning is CPU-bound and the app renders one video per process. */
let encodeChain: Promise<unknown> = Promise.resolve()
const inFlight = new Map<string, Promise<string>>()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = encodeChain.then(task, task)
  encodeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export interface BurnSubtitlesInput {
  directory: string
  videoBasename: string
  subtitleBasename: string
  outputBasename: string
}

/**
 * Burn `subtitleBasename` into `videoBasename`, writing `outputBasename` in the
 * same directory. Reuses an output newer than both inputs; concurrent calls for
 * the same output share one encode. Rejects on ffmpeg failure so callers can
 * decide whether that is fatal (render degrades) or surfaced (on-demand route).
 */
export function burnSubtitles(input: BurnSubtitlesInput): Promise<string> {
  const sourcePath = path.join(input.directory, input.videoBasename)
  const subtitlePath = path.join(input.directory, input.subtitleBasename)
  const outputPath = path.join(input.directory, input.outputBasename)

  if (!fs.existsSync(sourcePath)) {
    return Promise.reject(new Error(`Source video not found: ${sourcePath}`))
  }
  if (!fs.existsSync(subtitlePath)) {
    return Promise.reject(new Error(`Subtitle file not found: ${subtitlePath}`))
  }

  if (fs.existsSync(outputPath)) {
    const outputTime = fs.statSync(outputPath).mtimeMs
    const sourceTime = Math.max(fs.statSync(sourcePath).mtimeMs, fs.statSync(subtitlePath).mtimeMs)
    if (outputTime >= sourceTime) {
      return Promise.resolve(outputPath)
    }
  }

  const pending = inFlight.get(outputPath)
  if (pending) {
    return pending
  }

  const task = serialize(async () => {
    const tempName = `${input.outputBasename}.tmp-${process.pid}-${Date.now()}.mp4`
    const tempPath = path.join(input.directory, tempName)
    try {
      await execFileAsync('ffmpeg', buildHardSubtitleArgs({
        inputBasename: input.videoBasename,
        subtitleBasename: input.subtitleBasename,
        outputBasename: tempName
      }), input.directory)
      fs.renameSync(tempPath, outputPath)
      logger.info('Burned subtitles into video', { outputPath })
      return outputPath
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr
      logger.warn('Subtitle burn failed', {
        outputPath,
        error: error instanceof Error ? error.message : String(error),
        stderr: stderr?.slice(-800)
      })
      throw error
    } finally {
      fs.rmSync(tempPath, { force: true })
      inFlight.delete(outputPath)
    }
  })

  inFlight.set(outputPath, task)
  return task
}
