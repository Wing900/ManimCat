import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPatchSetToCode, parsePatchResponse } from '../code-retry/utils'

test('parses multiple hunks inside one patch block', () => {
  const result = parsePatchResponse(`[[PATCH]]
[[SEARCH]]
const a = 1
[[REPLACE]]
const a = 2
[[SEARCH]]
const b = 1
[[REPLACE]]
const b = 2
[[END]]`)

  assert.equal(result.patches.length, 2)
  assert.equal(
    applyPatchSetToCode('const a = 1\nconst b = 1', result),
    'const a = 2\nconst b = 2'
  )
})

test('parses multiple patch blocks in one response', () => {
  const result = parsePatchResponse(`[[PATCH]]
[[SEARCH]]
const a = 1
[[REPLACE]]
const a = 2
[[END]]
[[PATCH]]
[[SEARCH]]
const b = 1
[[REPLACE]]
const b = 2
[[END]]`)

  assert.equal(result.patches.length, 2)
  assert.equal(
    applyPatchSetToCode('const a = 1\nconst b = 1', result),
    'const a = 2\nconst b = 2'
  )
})

test('rejects a control marker nested inside SEARCH content', () => {
  assert.throws(
    () => parsePatchResponse(`[[PATCH]]
[[SEARCH]]
const a = 1
[[PATCH]]
[[REPLACE]]
const a = 2
[[END]]`),
    /nested \[\[PATCH\]\] marker/
  )
})

test('rejects a response without a PATCH block', () => {
  assert.throws(
    () => parsePatchResponse(`[[SEARCH]]
const a = 1
[[REPLACE]]
const a = 2
[[END]]`),
    /did not contain any \[\[PATCH\]\] blocks/
  )
})

test('rejects a patch that changes nothing', () => {
  assert.throws(
    () => parsePatchResponse(`[[PATCH]]
[[SEARCH]]
const a = 1
[[REPLACE]]
const a = 1
[[END]]`),
    /produced no change/
  )
})
