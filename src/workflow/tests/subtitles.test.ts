import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAPTION_MAX_WIDTH,
  VTT_CUE_SETTINGS,
  buildSubtitleCues,
  displayWidth,
  formatSrt,
  formatVtt,
  subtitleLanguageForVoice,
  type SubtitleSegmentInput
} from '../narration/subtitles'
import type { AlignedWordBoundary } from '../narration/text-alignment'

/** Build aligned words by locating each token in the source text. */
function words(source: string, tokens: readonly string[]): AlignedWordBoundary[] {
  const result: AlignedWordBoundary[] = []
  let cursor = 0
  let time = 0
  for (const token of tokens) {
    const startChar = source.indexOf(token, cursor)
    assert.ok(startChar >= 0, `token ${token} not found in source`)
    const endChar = startChar + token.length
    result.push({
      text: token,
      startChar,
      endChar,
      startTime: time,
      endTime: time + 0.4,
      offsetTicks: Math.round(time * 10_000_000)
    })
    time += 0.5
    cursor = endChar
  }
  return result
}

function segment(
  text: string,
  tokens: readonly string[],
  start = 0,
  duration = 60
): SubtitleSegmentInput {
  return { text, start, duration, words: words(text, tokens) }
}

test('wraps Latin words to the display-column budget without splitting words', () => {
  const tokens = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff', 'ggggg', 'hhhhh']
  const text = tokens.join(' ')
  const cues = buildSubtitleCues([segment(text, tokens)])

  assert.equal(cues.length, 2)
  assert.equal(cues[0].text, tokens.slice(0, 7).join(' '))
  assert.equal(displayWidth(cues[0].text), 41)
  assert.ok(displayWidth(cues[0].text) <= CAPTION_MAX_WIDTH)
  assert.equal(cues[1].text, 'hhhhh')
})

test('breaks a line after sentence punctuation instead of filling the row', () => {
  const tokens = ['alpha', 'beta.', 'gamma', 'delta']
  const text = tokens.join(' ')
  const cues = buildSubtitleCues([segment(text, tokens)])

  assert.equal(cues.length, 2)
  assert.equal(cues[0].text, 'alpha beta.')
  assert.equal(cues[1].text, 'gamma delta')
})

test('a cue lasts until the next line starts; the last ends at the last word', () => {
  const tokens = ['alpha', 'beta.', 'gamma', 'delta']
  const text = tokens.join(' ')
  const cues = buildSubtitleCues([segment(text, tokens, 10, 10)])

  // gamma is the third token, so it starts at 2 * 0.5s inside the segment.
  assert.equal(cues[0].start, 10)
  assert.equal(cues[0].end, 11)
  assert.equal(cues[1].start, 11)
  assert.equal(cues[1].end, 10 + 3 * 0.5 + 0.4)
})

test('clamps the final cue to the segment and extends flashes to the minimum', () => {
  const tokens = ['alpha', 'beta.']
  const text = tokens.join(' ')
  const cues = buildSubtitleCues([segment(text, tokens, 5, 0.9)])

  assert.equal(cues.length, 1)
  assert.ok(cues[0].end <= 5.9)
  assert.ok(cues[0].end - cues[0].start >= 0.6)
})

test('wraps Han text by display width (two columns per character)', () => {
  const chars = Array.from({ length: 22 }, (_, index) => '字')
  const text = chars.join('')
  const cues = buildSubtitleCues([
    {
      text,
      start: 0,
      duration: 20,
      words: chars.map((char, index) => ({
        text: char,
        startChar: index,
        endChar: index + 1,
        startTime: index * 0.5,
        endTime: index * 0.5 + 0.4,
        offsetTicks: index * 5_000_000
      }))
    }
  ])

  assert.equal(cues.length, 2)
  assert.equal(cues[0].text.length, 21)
  assert.equal(displayWidth(cues[0].text), 42)
  assert.equal(cues[1].text.length, 1)
})

test('falls back to one cue over the whole segment when no word aligned', () => {
  const cues = buildSubtitleCues([
    { text: 'A quiet shot.', start: 3, duration: 4, words: [] }
  ])

  assert.deepEqual(cues, [{ start: 3, end: 7, text: 'A quiet shot.' }])
})

test('silent segments produce no cue', () => {
  assert.deepEqual(
    buildSubtitleCues([{ text: '', start: 0, duration: 4, words: [] }]),
    []
  )
})

test('serialises SubRip with a comma before milliseconds', () => {
  const srt = formatSrt([
    { start: 0.5, end: 2, text: 'Hello' },
    { start: 2, end: 3.25, text: 'World' }
  ])

  assert.equal(
    srt,
    '1\n00:00:00,500 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:03,250\nWorld\n'
  )
})

test('serialises WebVTT with a dot before milliseconds and fixed cue settings', () => {
  const vtt = formatVtt([{ start: 0.5, end: 2, text: 'Hello' }])

  assert.equal(
    vtt,
    `WEBVTT\n\n00:00:00.500 --> 00:00:02.000 ${VTT_CUE_SETTINGS}\nHello\n`
  )
  assert.equal(VTT_CUE_SETTINGS, 'line:90% position:50% align:middle size:80%')
})

test('SubRip never carries WebVTT cue settings', () => {
  const srt = formatSrt([{ start: 0.5, end: 2, text: 'Hello' }])

  assert.doesNotMatch(srt, /line:|position:|align:|size:/)
})

test('language follows the selected voice', () => {
  assert.equal(subtitleLanguageForVoice('en-US-JennyNeural'), 'eng')
  assert.equal(subtitleLanguageForVoice('zh-CN-XiaoxiaoNeural'), 'chi')
})

test('cues never overlap after clamping', () => {
  const cues = buildSubtitleCues([
    { text: 'One.', start: 0, duration: 3, words: [] },
    { text: 'Two.', start: 2, duration: 3, words: [] }
  ])

  for (let index = 1; index < cues.length; index += 1) {
    assert.ok(cues[index].start >= cues[index - 1].end)
  }
})
