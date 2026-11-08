import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildHardSubtitleArgs, burnSubtitles } from '../../rendering/manim/hardsub'

const ffmpegReady =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0

function probeStreams(filePath: string): Array<{ codec_type?: string }> {
  const stdout = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath],
    { encoding: 'utf8' }
  )
  return (JSON.parse(stdout) as { streams?: Array<{ codec_type?: string }> }).streams ?? []
}

test('burn command paints the VTT and maps no subtitle stream', () => {
  const args = buildHardSubtitleArgs({
    inputBasename: 'clip.mp4',
    subtitleBasename: 'clip.vtt',
    outputBasename: 'clip-hardsub.mp4'
  })

  const filter = args[args.indexOf('-vf') + 1]
  assert.match(filter, /^subtitles=clip\.vtt:force_style='FontName=/)
  assert.match(filter, /PrimaryColour=&H00000000/)
  assert.match(filter, /OutlineColour=&H00FFFFFF/)
  assert.deepEqual(args.slice(-1), ['clip-hardsub.mp4'])
  assert.equal(args.includes('-c:s'), false)
  assert.deepEqual(args.filter(value => value === '-map'), ['-map', '-map'])
})

test('burns captions into the picture and drops the soft subtitle stream', { skip: !ffmpegReady }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hardsub-'))
  try {
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      path.join(directory, 'clip.mp4')
    ])
    fs.writeFileSync(
      path.join(directory, 'clip.vtt'),
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n',
      'utf8'
    )

    const output = await burnSubtitles({
      directory,
      videoBasename: 'clip.mp4',
      subtitleBasename: 'clip.vtt',
      outputBasename: 'clip-hardsub.mp4'
    })

    assert.ok(fs.existsSync(output))
    const streams = probeStreams(output)
    assert.ok(streams.some(stream => stream.codec_type === 'video'))
    assert.equal(streams.some(stream => stream.codec_type === 'subtitle'), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
