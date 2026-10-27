/**
 * Clean spoken text and map Edge ``WordBoundary`` events back to character
 * positions in that text.
 *
 * Edge reports word offsets in 100 ns ticks (10_000_000 ticks/second). It strips
 * punctuation from boundary text and emits one boundary per word/chunk, including
 * Chinese chunks. Matching is therefore sequential and normalized:
 *
 *   * strip cue markers, collapse whitespace, keep a marker's character position;
 *   * compare letters/digits only (case-folded) so punctuation cannot break a match;
 *   * advance a cursor so repeated words ("hello ... hello") match the right copy;
 *   * never use ``indexOf`` from 0, never map a missing cue to zero.
 */

import { NarrationError } from './narration-error'

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]/u
const MARKER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export interface ParsedCueMarker {
  id: string
  /** Start position of the word following this marker in cleanText. */
  position: number
}

export interface ParsedSegmentText {
  /** Speakable text: markers removed, whitespace collapsed. */
  cleanText: string
  /** Markers in source order with positions in cleanText. */
  markers: ParsedCueMarker[]
}

export interface EdgeWordBoundary {
  text: string
  /** 100 ns ticks from the start of the segment audio. */
  offsetTicks: number
  /** 100 ns ticks. */
  durationTicks: number
}

export interface AlignedWordBoundary {
  text: string
  startChar: number
  endChar: number
  startTime: number
  endTime: number
  offsetTicks: number
}

export interface AlignmentWarning {
  boundaryIndex: number
  text: string
  reason: 'empty-text' | 'not-found' | 'duplicate-zero-width'
}

function findMarkerClose(text: string, from: number): number {
  return text.indexOf(']]', from)
}

function nextSignificantChar(text: string, from: number): string | undefined {
  let index = from
  while (index < text.length) {
    const char = text[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (text.startsWith('[[', index)) {
      const close = findMarkerClose(text, index + 2)
      if (close < 0) return undefined
      index = close + 2
      continue
    }
    return char
  }
  return undefined
}

function isWordChar(char: string | undefined): boolean {
  return Boolean(char && WORD_CHAR.test(char))
}

/**
 * Remove [[cue_id]] markers from spoken text while retaining where each marker
 * points. A marker between two words inserts one separating space, so removing it
 * can never fuse two words into one spoken token.
 */
export function parseMarkedText(raw: string, segmentId: string): ParsedSegmentText {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new NarrationError('INVALID_PLAN', `Segment ${JSON.stringify(segmentId)} has no spoken text`, {
      segmentId
    })
  }

  const text = raw.normalize('NFC')
  const markers: ParsedCueMarker[] = []
  let clean = ''
  let pendingSpace = false
  let index = 0

  while (index < text.length) {
    if (text.startsWith('[[', index)) {
      const close = findMarkerClose(text, index + 2)
      if (close < 0) {
        throw new NarrationError(
          'INVALID_MARKER',
          `Segment ${JSON.stringify(segmentId)} has an unterminated [[cue marker`,
          { segmentId, position: index }
        )
      }
      const id = text.slice(index + 2, close).trim()
      if (!MARKER_ID.test(id)) {
        throw new NarrationError(
          'INVALID_MARKER',
          `Segment ${JSON.stringify(segmentId)} has invalid cue id ${JSON.stringify(id)}`,
          { segmentId, cueId: id }
        )
      }

      const following = nextSignificantChar(text, close + 2)
      const previous = clean.length > 0 ? clean[clean.length - 1] : undefined
      if (!pendingSpace && isWordChar(previous) && isWordChar(following)) {
        pendingSpace = true
      }

      const position = clean.length > 0 && pendingSpace ? clean.length + 1 : clean.length
      markers.push({ id, position })
      index = close + 2
      continue
    }

    const char = text[index]
    if (/\s/.test(char)) {
      pendingSpace = true
      index += 1
      continue
    }

    if (pendingSpace) {
      if (
        clean.length > 0 &&
        !clean.endsWith(' ') &&
        !PUNCTUATION_OR_SYMBOL.test(char)
      ) {
        clean += ' '
      }
      pendingSpace = false
    }
    clean += char
    index += 1
  }

  clean = clean.replace(/\s+$/u, '')
  for (const marker of markers) {
    marker.position = Math.min(marker.position, clean.length)
  }

  if (!WORD_CHAR.test(clean)) {
    throw new NarrationError(
      'EMPTY_SEGMENT_TEXT',
      `Segment ${JSON.stringify(segmentId)} has no speakable characters after removing cue markers`,
      { segmentId, cleanText: clean }
    )
  }

  return { cleanText: clean, markers }
}

interface NormalizedText {
  text: string
  /** For each normalized character, its source index in the original string. */
  sourceIndices: number[]
}

function normalizeForMatch(input: string): NormalizedText {
  let text = ''
  const sourceIndices: number[] = []
  let sourceIndex = 0
  for (const char of input) {
    if (WORD_CHAR.test(char)) {
      const lower = char.toLowerCase()
      for (const lowered of lower) {
        text += lowered
        sourceIndices.push(sourceIndex)
      }
    }
    sourceIndex += char.length
  }
  return { text, sourceIndices }
}

/**
 * Align service word boundaries with cleanText in order.
 *
 * A boundary that cannot be located is reported, not stretched onto an unrelated
 * word. Cue mapping fails loudly if it depends on such a boundary.
 */
export function alignWordBoundaries(
  cleanText: string,
  boundaries: readonly EdgeWordBoundary[]
): { aligned: AlignedWordBoundary[]; warnings: AlignmentWarning[] } {
  const normalized = normalizeForMatch(cleanText)
  const aligned: AlignedWordBoundary[] = []
  const warnings: AlignmentWarning[] = []
  let cursor = 0

  for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
    const boundary = boundaries[boundaryIndex]
    if (!boundary || typeof boundary.text !== 'string') {
      warnings.push({ boundaryIndex, text: '', reason: 'empty-text' })
      continue
    }
    const needle = normalizeForMatch(boundary.text).text
    if (!needle) {
      warnings.push({ boundaryIndex, text: boundary.text, reason: 'empty-text' })
      continue
    }

    let found = -1
    if (normalized.text.startsWith(needle, cursor)) {
      found = cursor
    } else {
      // A small forward window absorbs service spelling differences. The cursor
      // never moves backwards, so a repeated word cannot steal the first copy.
      const candidate = normalized.text.indexOf(needle, cursor)
      const window = Math.max(12, needle.length * 3 + 6)
      if (candidate >= 0 && candidate - cursor <= window) {
        found = candidate
      }
    }

    if (found < 0) {
      warnings.push({ boundaryIndex, text: boundary.text, reason: 'not-found' })
      continue
    }

    const lastNormalizedIndex = found + needle.length - 1
    const startChar = normalized.sourceIndices[found]
    const endChar = (normalized.sourceIndices[lastNormalizedIndex] ?? startChar) + 1
    if (startChar === undefined || endChar <= startChar) {
      warnings.push({ boundaryIndex, text: boundary.text, reason: 'not-found' })
      continue
    }

    const startTime = boundary.offsetTicks / 10_000_000
    const endTime = (boundary.offsetTicks + boundary.durationTicks) / 10_000_000
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0) {
      warnings.push({ boundaryIndex, text: boundary.text, reason: 'not-found' })
      continue
    }

    const previous = aligned[aligned.length - 1]
    if (previous && startChar <= previous.startChar) {
      // A duplicate/zero-width service event adds no new character position.
      warnings.push({ boundaryIndex, text: boundary.text, reason: 'duplicate-zero-width' })
      continue
    }

    aligned.push({
      text: boundary.text,
      startChar,
      endChar,
      startTime,
      endTime,
      offsetTicks: boundary.offsetTicks
    })
    cursor = found + needle.length
  }

  return { aligned, warnings }
}

function hasSpeechText(value: string): boolean {
  return WORD_CHAR.test(value)
}

/**
 * Map cue markers to segment-relative seconds using real word boundaries.
 *
 * A marker inside a word belongs to that word; a marker between words belongs to
 * the next word. A marker in trailing punctuation belongs to the segment end. Any
 * other unmapped marker throws — zero would silently shift the whole cue plan.
 */
export function mapCueTimes(
  parsed: ParsedSegmentText,
  aligned: readonly AlignedWordBoundary[],
  segmentDuration: number,
  segmentId: string,
  tickRate = 10_000_000
): Record<string, number> {
  if (tickRate !== 10_000_000) {
    throw new NarrationError(
      'TTS_FAILED',
      `Unexpected Edge tick rate ${tickRate}; expected 10000000 ticks/second`,
      { segmentId, tickRate }
    )
  }
  if (!(segmentDuration > 0) || !Number.isFinite(segmentDuration)) {
    throw new NarrationError('WAV_INVALID', `Segment ${segmentId} has invalid duration`, {
      segmentId,
      segmentDuration
    })
  }

  const cues: Record<string, number> = {}
  let previousTime = -1

  for (const marker of parsed.markers) {
    const containing = aligned.find(
      (boundary) => boundary.startChar <= marker.position && marker.position < boundary.endChar
    )
    const following = aligned.find((boundary) => boundary.startChar >= marker.position)
    const target = containing ?? following

    let time: number
    if (target) {
      time = target.startTime
    } else {
      const tail = parsed.cleanText.slice(marker.position)
      if (!hasSpeechText(tail)) {
        time = segmentDuration
      } else {
        throw new NarrationError(
          'CUE_UNMAPPED',
          `Cue [[${marker.id}]] in segment ${JSON.stringify(segmentId)} could not be mapped to a word boundary`,
          {
            segmentId,
            cueId: marker.id,
            position: marker.position,
            textAfterMarker: tail.slice(0, 80),
            boundaries: aligned.length
          }
        )
      }
    }

    time = Math.min(Math.max(time, 0), segmentDuration)
    if (time + 1e-6 < previousTime) {
      throw new NarrationError(
        'CUE_UNMAPPED',
        `Cue [[${marker.id}]] in segment ${JSON.stringify(segmentId)} maps before the previous cue`,
        { segmentId, cueId: marker.id, time, previousTime }
      )
    }
    cues[marker.id] = time
    previousTime = time
  }

  return cues
}

/** Exposed for callers that only need a quick sanity check. */
export function hasSpeakableText(value: string): boolean {
  return hasSpeechText(value)
}
