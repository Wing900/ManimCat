import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNarrationMuxArgs } from '../../rendering/manim/narration-mixer'

test('audio-only mux keeps the picture stream untouched', () => {
  const args = buildNarrationMuxArgs({
    videoPath: 'in.mp4',
    audioPath: 'voice.wav',
    outputPath: 'out.mp4'
  })

  assert.deepEqual(args, [
    '-y',
    '-i', 'in.mp4',
    '-i', 'voice.wav',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    'out.mp4'
  ])
})

test('a subtitle sidecar becomes a third input and a mov_text track', () => {
  const args = buildNarrationMuxArgs({
    videoPath: 'in.mp4',
    audioPath: 'voice.wav',
    subtitlePath: 'voice.srt',
    subtitleLanguage: 'eng',
    outputPath: 'out.mp4'
  })

  assert.deepEqual(args, [
    '-y',
    '-i', 'in.mp4',
    '-i', 'voice.wav',
    '-i', 'voice.srt',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-map', '2:s:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-c:s', 'mov_text',
    '-metadata:s:s:0', 'language=eng',
    '-movflags', '+faststart',
    'out.mp4'
  ])
})

test('a subtitle sidecar without a language still muxes', () => {
  const args = buildNarrationMuxArgs({
    videoPath: 'in.mp4',
    audioPath: 'voice.wav',
    subtitlePath: 'voice.srt',
    outputPath: 'out.mp4'
  })

  assert.ok(args.includes('-c:s'))
  assert.ok(!args.some((value) => value.startsWith('language=')))
})
