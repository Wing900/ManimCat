import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { muxNarrationIntoVideo } from '../../rendering/manim/narration-mixer'

const ffmpegReady =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0

function probeStreams(filePath: string): Array<{ codec_type?: string; codec_name?: string }> {
  const stdout = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath],
    { encoding: 'utf8' }
  )
  return (JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; codec_name?: string }> })
    .streams ?? []
}

function writeFixture(directory: string): { videoPath: string; audioPath: string } {
  const videoPath = path.join(directory, 'in.mp4')
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=2',
    '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    videoPath
  ])

  const audioPath = path.join(directory, 'voice.wav')
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
    '-t', '2',
    '-c:a', 'pcm_s16le',
    audioPath
  ])
  return { videoPath, audioPath }
}

test(
  'muxes a soft subtitle track into the rendered MP4',
  { skip: ffmpegReady ? false : 'ffmpeg / ffprobe not available' },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-mux-'))
    try {
      const { videoPath, audioPath } = writeFixture(directory)
      const subtitlePath = path.join(directory, 'voice.srt')
      fs.writeFileSync(
        subtitlePath,
        '1\n00:00:00,200 --> 00:00:01,500\nHello world\n',
        'utf8'
      )

      await muxNarrationIntoVideo({
        videoPath,
        narration: {
          manifestPath: path.join(directory, 'manifest.json'),
          audioPath,
          duration: 2,
          subtitleSrtPath: subtitlePath,
          subtitleLanguage: 'eng'
        }
      })

      const streams = probeStreams(videoPath)
      const subtitles = streams.filter((stream) => stream.codec_type === 'subtitle')
      assert.equal(subtitles.length, 1)
      assert.equal(subtitles[0].codec_name, 'mov_text')
      assert.ok(streams.some((stream) => stream.codec_type === 'audio'))

      const extracted = execFileSync(
        'ffmpeg',
        ['-v', 'quiet', '-i', videoPath, '-map', '0:s:0', '-f', 'srt', '-'],
        { encoding: 'utf8' }
      )
      assert.match(extracted, /Hello world/)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)

test(
  'degrades to audio only when the subtitle track cannot be written',
  { skip: ffmpegReady ? false : 'ffmpeg / ffprobe not available' },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-mux-fallback-'))
    try {
      const { videoPath, audioPath } = writeFixture(directory)
      const subtitlePath = path.join(directory, 'broken.srt')
      fs.writeFileSync(subtitlePath, 'not a subtitle file\n', 'utf8')

      await muxNarrationIntoVideo({
        videoPath,
        narration: {
          manifestPath: path.join(directory, 'manifest.json'),
          audioPath,
          duration: 2,
          subtitleSrtPath: subtitlePath,
          subtitleLanguage: 'eng'
        }
      })

      const streams = probeStreams(videoPath)
      assert.equal(streams.filter((stream) => stream.codec_type === 'subtitle').length, 0)
      assert.ok(streams.some((stream) => stream.codec_type === 'audio'))
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
