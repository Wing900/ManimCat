/**
 * Final narration muxing.
 *
 * The rendered video is always the authority for the picture stream. This module only appends the
 * server-generated narration track. It deliberately never uses `-shortest`: a voice tail that runs
 * past the last visual must survive into the MP4 instead of being clipped.
 */

import { execFile } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../../shared/logging/logger'
import { resolveRenderCacheWorkspace } from '../../utils/render-cache-workspace'
import type { NarrationAssets, NarrationConfig } from '../../workflow/narration/types'

const logger = createLogger('NarrationMixer')

const OUTPUT_AUDIO_BITRATE = '192k'

export interface NarrationWorkspace {
  /** Directory owned by this job inside the render-cache run subtree. */
  outputDirectory: string
  /** Where the runtime writes measured cue timestamps for acceptance. */
  syncReportPath: string
  rootDirectory: string
}

/**
 * Resolves the server-side narration workspace for one render run.
 *
 * Audio paths are never accepted from the client: they are derived here from the same
 * `renderCacheKey` scoping the renderer already uses, so a retry of the same job reuses its audio
 * sidecar while another job can never read or overwrite it.
 */
export function resolveNarrationWorkspace(renderCacheKey: string | undefined, jobId: string): NarrationWorkspace {
  const workspace = resolveRenderCacheWorkspace(renderCacheKey || `job-${jobId}`, 'video', jobId)
  const outputDirectory = path.join(workspace.rootDir, 'narration')
  return {
    outputDirectory,
    syncReportPath: path.join(outputDirectory, 'sync-report.json'),
    rootDirectory: workspace.rootDir
  }
}

/** Returns the effective narration config, or undefined when this render must stay silent. */
export function resolveNarrationConfig(
  videoConfig: { narration?: NarrationConfig } | undefined,
  outputMode: 'video' | 'image'
): NarrationConfig | undefined {
  if (outputMode !== 'video') {
    return undefined
  }
  const config = videoConfig?.narration
  if (!config?.enabled) {
    return undefined
  }
  return config
}

/** Best-effort cleanup for cancelled/failed runs; never touches anything outside the job subtree. */
export function cleanupNarrationWorkspace(outputDirectory: string | undefined): void {
  if (!outputDirectory) {
    return
  }
  try {
    fs.rmSync(outputDirectory, { recursive: true, force: true })
  } catch (error) {
    logger.warn('Unable to clean narration workspace', { outputDirectory, error: String(error) })
  }
}

function execFileAsync(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

async function probeMedia(filePath: string): Promise<{
  duration: number
  hasAudio: boolean
  hasSubtitle: boolean
  audioDuration: number
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ])
  const info = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; duration?: string }>
  }
  const streams = info.streams ?? []
  const audioStream = streams.find((stream) => stream.codec_type === 'audio')
  return {
    duration: Number.parseFloat(info.format?.duration ?? '0') || 0,
    hasAudio: Boolean(audioStream),
    hasSubtitle: streams.some((stream) => stream.codec_type === 'subtitle'),
    audioDuration: Number.parseFloat(audioStream?.duration ?? info.format?.duration ?? '0') || 0
  }
}

export interface MuxNarrationOptions {
  /** Rendered MP4, replaced in place only after the mux succeeds. */
  videoPath: string
  narration: NarrationAssets
}

export interface NarrationMuxArgvOptions {
  videoPath: string
  audioPath: string
  /** Optional SubRip sidecar; when present the film gains a soft subtitle track. */
  subtitlePath?: string
  /** ISO 639-2 code recorded on the subtitle stream (`eng` / `chi`). */
  subtitleLanguage?: string
  outputPath: string
}

/**
 * Build the single ffmpeg invocation that adds narration (and its subtitle track)
 * to an already-rendered picture. Exported so argument shape stays unit-testable
 * without spawning ffmpeg.
 */
export function buildNarrationMuxArgs(options: NarrationMuxArgvOptions): string[] {
  const args: string[] = ['-y', '-i', options.videoPath, '-i', options.audioPath]
  if (options.subtitlePath) {
    args.push('-i', options.subtitlePath)
  }
  args.push('-map', '0:v:0', '-map', '1:a:0')
  if (options.subtitlePath) {
    args.push('-map', '2:s:0')
  }
  args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', OUTPUT_AUDIO_BITRATE)
  if (options.subtitlePath) {
    args.push('-c:s', 'mov_text')
    if (options.subtitleLanguage) {
      args.push('-metadata:s:s:0', `language=${options.subtitleLanguage}`)
    }
  }
  args.push('-movflags', '+faststart', options.outputPath)
  return args
}

function existingSubtitle(narration: NarrationAssets): string | undefined {
  const candidate = narration.subtitleSrtPath
  if (!candidate) return undefined
  try {
    const stat = fs.statSync(candidate)
    return stat.isFile() && stat.size > 0 ? candidate : undefined
  } catch {
    return undefined
  }
}

/**
 * Muxes the narration track into the rendered video and returns the final path.
 *
 * A missing audio file or a mux failure is a real failure — silently shipping an unvoiced video
 * would misrepresent what the user asked for. Subtitles are auxiliary: if the subtitle track
 * cannot be written, the film is still muxed with audio and the failure is logged, never hidden.
 */
export async function muxNarrationIntoVideo(options: MuxNarrationOptions): Promise<string> {
  const { videoPath, narration } = options

  if (!narration.audioPath || !fs.existsSync(narration.audioPath)) {
    throw new Error(`Narration audio file is missing: ${narration.audioPath}`)
  }
  if (!(narration.duration > 0)) {
    throw new Error(`Narration duration is invalid: ${narration.duration}`)
  }

  const directory = path.dirname(videoPath)
  const extension = path.extname(videoPath)
  const base = path.basename(videoPath, extension)
  const tempOutput = path.join(directory, `${base}_narration${extension}`)
  const subtitlePath = existingSubtitle(narration)

  const attempt = async (withSubtitles: boolean): Promise<{
    duration: number
    audioDuration: number
  }> => {
    fs.rmSync(tempOutput, { force: true })
    const args = buildNarrationMuxArgs({
      videoPath,
      audioPath: narration.audioPath,
      ...(withSubtitles && subtitlePath ? { subtitlePath } : {}),
      ...(withSubtitles && narration.subtitleLanguage
        ? { subtitleLanguage: narration.subtitleLanguage }
        : {}),
      outputPath: tempOutput
    })

    logger.info('Muxing narration into rendered video', {
      videoPath,
      audioPath: narration.audioPath,
      duration: narration.duration,
      subtitles: withSubtitles && Boolean(subtitlePath)
    })

    await execFileAsync('ffmpeg', args)

    const probe = await probeMedia(tempOutput)
    if (!probe.hasAudio) {
      throw new Error('Muxed video has no audio stream')
    }
    // The final container may be longer than the picture (frozen last frame while the voice tail
    // plays); what matters is that the narration itself was not truncated.
    if (probe.audioDuration + 0.25 < narration.duration) {
      throw new Error(
        `Muxed audio is shorter than the narration (${probe.audioDuration}s < ${narration.duration}s)`
      )
    }
    if (withSubtitles && subtitlePath && !probe.hasSubtitle) {
      throw new Error('Muxed video has no subtitle stream')
    }
    return { duration: probe.duration, audioDuration: probe.audioDuration }
  }

  const failure = async (error: unknown, withSubtitles: boolean): Promise<never> => {
    fs.rmSync(tempOutput, { force: true })
    const stderr = (error as { stderr?: string }).stderr
    throw new Error(
      `Narration muxing failed${withSubtitles ? ' while adding subtitles' : ''}: ${
        error instanceof Error ? error.message : String(error)
      }${stderr ? `\n${stderr.slice(-2000)}` : ''}`
    )
  }

  let probe: { duration: number; audioDuration: number }
  try {
    probe = await attempt(Boolean(subtitlePath))
  } catch (error) {
    if (!subtitlePath) {
      return failure(error, false)
    }
    logger.warn('Subtitle mux failed; retrying with audio only', {
      videoPath,
      subtitlePath,
      error: error instanceof Error ? error.message : String(error)
    })
    try {
      probe = await attempt(false)
    } catch (retryError) {
      return failure(retryError, false)
    }
  }

  fs.renameSync(tempOutput, videoPath)
  logger.info('Narration mux complete', {
    videoPath,
    duration: probe.duration,
    audioDuration: probe.audioDuration
  })
  return videoPath
}
