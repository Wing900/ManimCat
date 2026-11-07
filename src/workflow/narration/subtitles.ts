/**
 * Narration subtitles: aligned Edge words -> timed caption lines -> SRT / WebVTT.
 *
 * The text is already spoken; this module never rewrites or translates it. It only
 * decides where a line breaks and how long it stays on screen. Word timings come
 * from the same `alignWordBoundaries` pass that maps cue markers, so subtitles and
 * cue timing cannot drift apart.
 */

import type { AlignedWordBoundary } from './text-alignment'

/** One shot's spoken text with its absolute place in the final track. */
export interface SubtitleSegmentInput {
  /** Speakable text, cue markers already removed. */
  text: string
  /** Absolute seconds in the complete narration track. */
  start: number
  /** Audio duration of this segment. */
  duration: number
  /** Segment-relative word boundaries from Edge TTS. */
  words: readonly AlignedWordBoundary[]
}

export interface SubtitleCue {
  /** Absolute seconds in the complete narration track. */
  start: number
  end: number
  text: string
}

/**
 * A caption line spans at most this many display columns: a CJK character counts
 * two, a Latin character one. 42 columns is ~42 Latin characters or ~21 Han
 * characters, which fits a 16:9 frame without shrinking the type.
 */
export const CAPTION_MAX_WIDTH = 42
/** A cue shorter than this reads as a flash; extend it when the next cue allows. */
export const MIN_CUE_SECONDS = 0.6
/** A cue shorter than this after clamping carries no readable text. */
const MIN_USEFUL_CUE_SECONDS = 0.05

const WIDE_CHAR =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u

export function displayWidth(value: string): number {
  let width = 0
  for (const char of value) {
    width += WIDE_CHAR.test(char) ? 2 : 1
  }
  return width
}

/** ISO 639-2 language for the subtitle stream; subtitles follow the voice. */
export function subtitleLanguageForVoice(voice: string): 'eng' | 'chi' {
  return /^en[-_]/i.test(voice) ? 'eng' : 'chi'
}

interface CaptionWord {
  text: string
  start: number
  end: number
  startChar: number
  endChar: number
}

function isSentencePause(source: string, from: number, to: number): boolean {
  if (to <= from) return false
  return /[.!?。！？…]/.test(source.slice(from, to))
}

function separator(source: string, previous: CaptionWord, next: CaptionWord): string {
  const gap = source.slice(previous.endChar, next.startChar)
  return /\s/.test(gap) ? ' ' : ''
}

function joinWords(words: readonly CaptionWord[], source: string): string {
  let text = ''
  for (let index = 0; index < words.length; index += 1) {
    if (index === 0) {
      text = words[index].text
      continue
    }
    text += separator(source, words[index - 1], words[index]) + words[index].text
  }
  return text
}

function toCaptionWords(
  words: readonly AlignedWordBoundary[],
  source: string
): CaptionWord[] {
  const result: CaptionWord[] = []
  for (const word of words) {
    const text = typeof word.text === 'string' ? word.text.trim() : ''
    if (!text) continue
    if (!(word.startTime >= 0) || !(word.endTime > word.startTime)) continue
    if (!Number.isFinite(word.startChar) || !Number.isFinite(word.endChar)) continue
    result.push({
      text,
      start: word.startTime,
      end: word.endTime,
      startChar: word.startChar,
      endChar: word.endChar
    })
  }
  result.sort((a, b) => a.start - b.start)
  return result
}

function wrapWords(words: readonly CaptionWord[], source: string): CaptionWord[][] {
  const lines: CaptionWord[][] = []
  let line: CaptionWord[] = []

  const flush = (): void => {
    if (line.length > 0) {
      lines.push(line)
      line = []
    }
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const next: CaptionWord | undefined = words[index + 1]
    const candidate = [...line, word]
    if (line.length > 0 && displayWidth(joinWords(candidate, source)) > CAPTION_MAX_WIDTH) {
      flush()
    }
    line.push(word)
    const endsSentence =
      /[.!?。！？…]$/.test(word.text) ||
      (next ? isSentencePause(source, word.endChar, next.startChar) : false)
    if (next && endsSentence) {
      flush()
    }
  }
  flush()
  return lines
}

/**
 * Fallback for a segment whose word boundaries did not align: keep the whole line
 * on screen for the segment. Text is wrapped by display width, never rewritten.
 */
function wrapPlainText(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const lines: string[] = []
  let line = ''
  let width = 0

  for (const char of normalized) {
    const charWidth = WIDE_CHAR.test(char) ? 2 : 1
    if (width + charWidth > CAPTION_MAX_WIDTH && line.trim()) {
      const breakAt = line.lastIndexOf(' ')
      if (breakAt > 0) {
        lines.push(line.slice(0, breakAt).trimEnd())
        line = line.slice(breakAt + 1)
        width = displayWidth(line)
      } else {
        lines.push(line.trimEnd())
        line = ''
        width = 0
      }
    }
    if (!line && char === ' ') continue
    line += char
    width += charWidth
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Build caption cues from aligned words. One cue per line; a line stays until the
 * next line starts, so captions follow speech rather than fixed intervals.
 */
export function buildSubtitleCues(segments: readonly SubtitleSegmentInput[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []

  for (const segment of segments) {
    if (!segment || typeof segment.text !== 'string') continue
    const text = segment.text.trim()
    if (!text) continue
    const segmentStart = Number(segment.start)
    const segmentDuration = Number(segment.duration)
    if (!Number.isFinite(segmentStart) || segmentStart < 0) continue
    if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) continue
    const segmentEnd = segmentStart + segmentDuration

    const words = toCaptionWords(segment.words ?? [], segment.text)
    if (words.length === 0) {
      const lines = wrapPlainText(text)
      if (lines.length === 0) continue
      cues.push({
        start: roundSeconds(segmentStart),
        end: roundSeconds(segmentEnd),
        text: lines.join('\n')
      })
      continue
    }

    const lines = wrapWords(words, segment.text)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const nextLine = lines[index + 1]
      const start = segmentStart + line[0].start
      const naturalEnd = nextLine ? segmentStart + nextLine[0].start : segmentStart + line[line.length - 1].end
      const limit = nextLine ? segmentStart + nextLine[0].start : segmentEnd
      let end = Math.min(naturalEnd, segmentEnd)

      if (end - start < MIN_CUE_SECONDS) {
        end = Math.min(Math.max(start + MIN_CUE_SECONDS, end), limit, segmentEnd)
      }
      if (!(end > start) || end - start < MIN_USEFUL_CUE_SECONDS) continue

      cues.push({
        start: roundSeconds(Math.max(0, start)),
        end: roundSeconds(Math.max(0, end)),
        text: joinWords(line, segment.text)
      })
    }
  }

  cues.sort((a, b) => a.start - b.start || a.end - b.end)
  const bounded: SubtitleCue[] = []
  for (const cue of cues) {
    if (!cue.text || !(cue.end > cue.start)) continue
    const previous = bounded[bounded.length - 1]
    if (previous && cue.start < previous.end) {
      previous.end = roundSeconds(Math.max(previous.start, cue.start))
      if (!(previous.end > previous.start)) bounded.pop()
    }
    bounded.push(cue)
  }
  return bounded
}

function stamp(seconds: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const secs = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis, 3)}`
}

export function formatSrt(cues: readonly SubtitleCue[]): string {
  if (cues.length === 0) return ''
  return cues
    .map((cue, index) => {
      const body = cue.text.replace(/\r\n?/g, '\n').trim()
      return `${index + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${body}\n`
    })
    .join('\n')
}

/**
 * Cue settings written on every WebVTT timing line: the caption stays pinned near
 * the bottom edge, centred, in a box that cannot grow wide enough to wrap. Values
 * are percentages of the video box, so they hold at any display size. SRT has no
 * equivalent syntax; the embedded mov_text track keeps the player's own default.
 */
export const VTT_CUE_SETTINGS = 'line:90% position:50% align:middle size:80%'

export function formatVtt(cues: readonly SubtitleCue[]): string {
  if (cues.length === 0) return ''
  const blocks = cues.map((cue) => {
    const body = cue.text.replace(/\r\n?/g, '\n').trim()
    return `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')} ${VTT_CUE_SETTINGS}\n${body}\n`
  })
  return `WEBVTT\n\n${blocks.join('\n')}`
}
