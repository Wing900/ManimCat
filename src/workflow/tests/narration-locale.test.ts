import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNarrationLocale } from '../narration/narration-stage'

test('an English voice narrates in English even when the UI is Chinese', () => {
  assert.equal(
    resolveNarrationLocale({ enabled: true, voice: 'en-US-JennyNeural', rate: '+0%' }),
    'en-US'
  )
})

test('a Chinese voice narrates in Chinese even when the UI is English', () => {
  assert.equal(
    resolveNarrationLocale({ enabled: true, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' }),
    'zh-CN'
  )
})

test('an explicit caller locale still wins over the voice', () => {
  assert.equal(
    resolveNarrationLocale({ enabled: true, voice: 'en-US-GuyNeural', rate: '+0%' }, 'zh-CN'),
    'zh-CN'
  )
})
