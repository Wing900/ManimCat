import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '../../shared/logging/logger'

const logger = createLogger('BgmMixer')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TRACKS_DIR = path.join(__dirname, 'tracks')
const FADE_DURATION = 3

function getTrackFiles(): string[] {
  return fs
    .readdirSync(TRACKS_DIR)
    .filter((f) => f.endsWith('.mp3'))
    .map((f) => path.join(TRACKS_DIR, f))
}

function execAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

async function getMediaDuration(filePath: string): Promise<number> {
  const { stdout } = await execAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    filePath
  ])
  const info = JSON.parse(stdout)
  return parseFloat(info.format.duration)
}

async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('ffprobe', [
      '-v', 'quiet',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-print_format', 'json',
      videoPath
    ])
    const info = JSON.parse(stdout)
    return Array.isArray(info.streams) && info.streams.length > 0
  } catch {
    return false
  }
}

export async function addBackgroundMusic(videoPath: string): Promise<string> {
  try {
    const tracks = getTrackFiles()
    if (tracks.length === 0) {
      logger.warn('No BGM tracks found, skipping')
      return videoPath
    }

    const videoDuration = await getMediaDuration(videoPath)
    if (videoDuration <= 0) {
      logger.warn('Could not determine video duration, skipping BGM')
      return videoPath
    }

    // Pick a random track
    const trackPath = tracks[Math.floor(Math.random() * tracks.length)]
    const trackDuration = await getMediaDuration(trackPath)

    // Pick a random start offset (ensure enough remaining duration)
    let startOffset = 0
    if (trackDuration > videoDuration) {
      const maxOffset = trackDuration - videoDuration
      startOffset = Math.floor(Math.random() * maxOffset)
    }

    const fadeStart = Math.max(0, videoDuration - FADE_DURATION)
    const videoHasAudio = await hasAudioStream(videoPath)

    const dir = path.dirname(videoPath)
    const ext = path.extname(videoPath)
    const base = path.basename(videoPath, ext)
    const tmpOutput = path.join(dir, `${base}_bgm${ext}`)

    logger.info('Adding BGM', {
      track: path.basename(trackPath),
      startOffset,
      videoDuration,
      fadeStart,
      videoHasAudio
    })

    const args: string[] = [
      '-y',
      '-i', videoPath,
      '-ss', String(startOffset),
      '-i', trackPath
    ]

    if (videoHasAudio) {
      // Mix original audio with BGM
      args.push(
        '-filter_complex',
        `[1:a]volume=-20dB,afade=t=out:st=${fadeStart}:d=${FADE_DURATION}[bgm];[0:a][bgm]amix=inputs=2:duration=first[aout]`,
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-shortest'
      )
    } else {
      // No original audio — use BGM as the only audio stream
      args.push(
        '-filter_complex',
        `[1:a]volume=-20dB,afade=t=out:st=${fadeStart}:d=${FADE_DURATION}[bgm]`,
        '-map', '0:v',
        '-map', '[bgm]',
        '-c:v', 'copy',
        '-shortest'
      )
    }

    args.push(tmpOutput)

    await execAsync('ffmpeg', args)
    // Replace original file
    fs.unlinkSync(videoPath)
    fs.renameSync(tmpOutput, videoPath)
    logger.info('BGM added successfully', { videoPath })
    return videoPath
  } catch (err) {
    logger.warn('Failed to add BGM, keeping original video', { error: String(err) })
    return videoPath
  }
}
