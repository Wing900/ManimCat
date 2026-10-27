/**
 * Core narration contract regressions.
 *
 * These tests cover the edges that make cue-synced audio trustworthy:
 *   * repeated Chinese words must map to the correct copy, not the first hit;
 *   * Edge offsets are 100 ns ticks, never seconds or milliseconds;
 *   * a malformed marker / unmappable cue must fail loudly instead of landing at 0;
 *   * duplicate cue ids must be rejected before any TTS call.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { alignWordBoundaries, mapCueTimes, parseMarkedText } from '../narration/text-alignment'
import { NarrationError } from '../narration/narration-error'
import { NarrationCuePlanError, parseCuePlan } from '../narration/cue-plan'
import { validateNarrationPlan } from '../narration/narration-stage'
import { prepareNarration } from '../narration/prepare-narration'
import { getRoleUserPrompt } from '../../prompts/loader'
import type { CuePlan } from '../narration/types'

const TICKS = 10_000_000

function boundary(text: string, seconds: number, durationSeconds = 0.2) {
  return {
    text,
    offsetTicks: Math.round(seconds * TICKS),
    durationTicks: Math.round(durationSeconds * TICKS)
  }
}

test('Chinese repeated words map each cue to its own copy', () => {
  const parsed = parseMarkedText('[[cue-1]]第一，位移。[[cue-2]]第一，速度。', 'seg-1')
  assert.equal(parsed.cleanText, '第一，位移。第一，速度。')
  assert.deepEqual(
    parsed.markers.map((marker) => [marker.id, marker.position]),
    [
      ['cue-1', 0],
      ['cue-2', 6]
    ]
  )

  const { aligned, warnings } = alignWordBoundaries(parsed.cleanText, [
    boundary('第一', 0),
    boundary('位移', 0.4),
    boundary('第一', 0.8),
    boundary('速度', 1.2)
  ])
  assert.equal(warnings.length, 0)
  assert.deepEqual(
    aligned.map((word) => [word.text, word.startChar, word.startTime]),
    [
      ['第一', 0, 0],
      // Punctuation still occupies a character position: "第一，位移。".
      ['位移', 3, 0.4],
      ['第一', 6, 0.8],
      ['速度', 9, 1.2]
    ]
  )

  assert.deepEqual(mapCueTimes(parsed, aligned, 1.5, 'seg-1'), {
    'cue-1': 0,
    'cue-2': 0.8
  })
})

test('a cue marker between adjacent repeated words points at the second copy', () => {
  const parsed = parseMarkedText('第一[[cue-1]]第一', 'seg-1')
  // Removing a marker between two words must not fuse them into one token.
  assert.equal(parsed.cleanText, '第一 第一')
  assert.deepEqual(
    parsed.markers.map((marker) => [marker.id, marker.position]),
    [['cue-1', 3]]
  )

  const { aligned, warnings } = alignWordBoundaries(parsed.cleanText, [
    boundary('第一', 0.2),
    boundary('第一', 0.9)
  ])
  assert.equal(warnings.length, 0)
  assert.deepEqual(mapCueTimes(parsed, aligned, 1.4, 'seg-1'), { 'cue-1': 0.9 })
})

test('Edge offsets are converted from 100 ns ticks to seconds exactly', () => {
  const parsed = parseMarkedText('[[cue-1]]半径 r', 'seg-1')
  const { aligned, warnings } = alignWordBoundaries(parsed.cleanText, [
    boundary('半径', 2.5, 0.5),
    boundary('r', 3, 0.25)
  ])
  assert.equal(warnings.length, 0)
  assert.equal(aligned[0].startTime, 2.5)
  assert.equal(aligned[0].endTime, 3)
  assert.equal(aligned[1].startTime, 3)
  assert.deepEqual(mapCueTimes(parsed, aligned, 4, 'seg-1'), { 'cue-1': 2.5 })

  // A tick rate other than 1e7 is a contract violation, not a silent rescale.
  assert.throws(
    () => mapCueTimes(parsed, aligned, 4, 'seg-1', 1_000_000),
    (error: unknown) => error instanceof NarrationError && error.code === 'TTS_FAILED'
  )
})

test('malformed or unmappable cues fail loudly instead of mapping to zero', () => {
  assert.throws(
    () => parseMarkedText('你好 [[bad id]]', 'seg-1'),
    (error: unknown) => error instanceof NarrationError && error.code === 'INVALID_MARKER'
  )
  assert.throws(
    () => parseMarkedText('你好 [[cue-1', 'seg-1'),
    (error: unknown) => error instanceof NarrationError && error.code === 'INVALID_MARKER'
  )
  assert.throws(
    () => parseMarkedText('[[cue-1]]', 'seg-1'),
    (error: unknown) => error instanceof NarrationError && error.code === 'EMPTY_SEGMENT_TEXT'
  )

  const parsed = parseMarkedText('[[cue-1]]你好世界', 'seg-1')
  // Alignment found nothing (or only stale boundaries): a cue with real speech after it
  // cannot be guessed onto any word, so this must throw.
  assert.throws(
    () => mapCueTimes(parsed, [], 2, 'seg-1'),
    (error: unknown) => error instanceof NarrationError && error.code === 'CUE_UNMAPPED'
  )

  // A marker followed only by punctuation is a deliberate segment-end cue.
  const tail = parseMarkedText('你好[[cue-1]]。', 'seg-1')
  const aligned = alignWordBoundaries(tail.cleanText, [boundary('你好', 0.3, 0.4)]).aligned
  assert.deepEqual(mapCueTimes(tail, aligned, 1.25, 'seg-1'), { 'cue-1': 1.25 })
})

test('duplicate cue ids are rejected by the plan parser and before TTS', async () => {
  const duplicatePlan = `<design><cue_plan>{"segments":[
    {"id":"seg-1","visuals":"a","cues":[{"id":"cue-1","action":"a"}]},
    {"id":"seg-2","visuals":"b","cues":[{"id":"cue-1","action":"b"}]}
  ]}</cue_plan></design>`
  assert.throws(
    () => parseCuePlan(duplicatePlan),
    (error: unknown) => error instanceof NarrationCuePlanError
  )

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'narration-contract-'))
  try {
    await assert.rejects(
      prepareNarration({
        plan: {
          segments: [
            { id: 'seg-1', text: '[[cue-1]]第一段' },
            { id: 'seg-2', text: '[[cue-1]]第二段' }
          ]
        },
        outputDirectory: directory,
        cacheDirectory: path.join(directory, 'cache'),
        config: { enabled: true, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' }
      }),
      (error: unknown) => error instanceof NarrationError && error.code === 'DUPLICATE_CUE'
    )
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

test('narration plan validation rejects missing, repeated and reordered markers', () => {
  const cuePlan: CuePlan = {
    segments: [
      {
        id: 'seg-1',
        visuals: 'a',
        cues: [
          { id: 'cue-1', action: 'a' },
          { id: 'cue-2', action: 'b' }
        ]
      }
    ]
  }

  assert.doesNotThrow(() =>
    validateNarrationPlan({ segments: [{ id: 'seg-1', text: '[[cue-1]]甲，[[cue-2]]乙。' }] }, cuePlan)
  )

  const invalidTexts = [
    '没有标记。',
    '[[cue-1]]甲，[[cue-1]]乙。',
    '[[cue-2]]甲，[[cue-1]]乙。',
    '[[cue-1]]甲，[[cue-3]]乙。'
  ]
  for (const text of invalidTexts) {
    assert.throws(
      () => validateNarrationPlan({ segments: [{ id: 'seg-1', text }] }, cuePlan),
      /cue|marker|segment/i,
      text
    )
  }
})

test('narration off leaves the coder and designer prompts byte-identical to unset', () => {
  const base = {
    concept: '解释圆的面积',
    seed: 'abc123',
    sceneDesign: '<design>四节分镜</design>',
    outputMode: 'video' as const,
    isVideo: true,
    isImage: false
  }
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const overrides = { locale }
    for (const role of ['codeGeneration', 'conceptDesigner'] as const) {
      const withoutFlag = getRoleUserPrompt(role, base, overrides)
      const explicitlyOff = getRoleUserPrompt(role, { ...base, narrationEnabled: false }, overrides)
      assert.equal(explicitlyOff, withoutFlag, `${locale}/${role} disabled prompt changed`)
      assert.equal(/cue_plan|self\.cue|旁白同步|Narration sync/i.test(explicitlyOff), false)
    }
  }
})
