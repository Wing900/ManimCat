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
  /**
   * Source nominal frame rate, e.g. `60/1`. The fps filter runs before `subtitles`
   * so a VFR hold tail is materialised into real frames; without it the encoder
   * drops the held time and the captions covering that tail are never painted.
   */
  frameRate: string
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
    `fps=${input.frameRate},subtitles=${input.subtitleBasename}:force_style='${hardSubtitleStyle()}'`,
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

interface CommandResult {
  stdout: string
  stderr: string
}

function execFileCapture(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

function execFileAsync(command: string, args: string[], cwd: string): Promise<void> {
  return execFileCapture(command, args, cwd).then(() => undefined)
}

interface VideoProbe {
  /** Nominal rate (`r_frame_rate`), falling back to the average rate. */
  frameRate?: string
  /** Video-stream duration. Falls back to the container duration only when the stream omits it. */
  duration: number
}

function normalizeFrameRate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const match = /^(\d+)\/(\d+)$/.exec(raw.trim())
  if (!match) return undefined
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return undefined
  if (numerator <= 0 || denominator <= 0) return undefined
  return `${numerator}/${denominator}`
}

function toSeconds(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

async function probeVideo(filePath: string): Promise<VideoProbe> {
  const { stdout } = await execFileCapture('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=r_frame_rate,avg_frame_rate,duration',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    filePath
  ])
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ r_frame_rate?: string; avg_frame_rate?: string; duration?: string }>
    format?: { duration?: string }
  }
  const stream = parsed.streams?.[0]
  return {
    frameRate:
      normalizeFrameRate(stream?.r_frame_rate) ??
      normalizeFrameRate(stream?.avg_frame_rate),
    duration: toSeconds(stream?.duration) ?? toSeconds(parsed.format?.duration) ?? 0
  }
}

/** A re-encoded cache is allowed to be slightly shorter than the source. */
const CACHE_DURATION_TOLERANCE_SECONDS = 0.25

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
export async function burnSubtitles(input: BurnSubtitlesInput): Promise<string> {
  const sourcePath = path.join(input.directory, input.videoBasename)
  const subtitlePath = path.join(input.directory, input.subtitleBasename)
  const outputPath = path.join(input.directory, input.outputBasename)

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source video not found: ${sourcePath}`)
  }
  if (!fs.existsSync(subtitlePath)) {
    throw new Error(`Subtitle file not found: ${subtitlePath}`)
  }

  const source = await probeVideo(sourcePath)
  const frameRate = source.frameRate
  if (!frameRate) {
    throw new Error(`Unable to determine video frame rate: ${sourcePath}`)
  }

  if (fs.existsSync(outputPath)) {
    const outputTime = fs.statSync(outputPath).mtimeMs
    const sourceTime = Math.max(fs.statSync(sourcePath).mtimeMs, fs.statSync(subtitlePath).mtimeMs)
    if (outputTime >= sourceTime) {
      // Older burns lost a VFR hold tail and came out shorter than the source; reburn
      // those instead of serving a cached file whose last captions are missing.
      let cached: VideoProbe | undefined
      try {
        cached = await probeVideo(outputPath)
      } catch {
        cached = undefined
      }
      if (
        !cached ||
        !(source.duration > 0) ||
        !(cached.duration > 0) ||
        cached.duration + CACHE_DURATION_TOLERANCE_SECONDS >= source.duration
      ) {
        return outputPath
      }
      logger.info('Cached hardsub is shorter than source; re-burning', {
        outputPath,
        sourceDuration: source.duration,
        cachedDuration: cached.duration
      })
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
        outputBasename: tempName,
        frameRate
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
