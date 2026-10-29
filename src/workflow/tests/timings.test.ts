import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTimings, totalTimings } from '../../shared/time/timings'

test('totalTimings includes mux and every measured stage', () => {
  const timings = {
    queue: 1_000,
    analyze: 2_000,
    generate: 3_000,
    retry: 500,
    render: 10_000,
    mux: 2_000,
    store: 100,
  }

  assert.equal(totalTimings(timings), 18_600)
})

test('normalizeTimings keeps zero, drops invalid and negative values, and rounds spans', () => {
  const normalized = normalizeTimings({
    queue: 0,
    analyze: -1,
    generate: 1.6,
    render: Number.NaN,
    mux: Number.POSITIVE_INFINITY,
    store: 2.4,
    total: 4,
  })

  assert.deepEqual(normalized, {
    queue: 0,
    generate: 2,
    store: 2,
    total: 4,
  })
})

test('normalizeTimings returns undefined when every value is invalid', () => {
  assert.equal(
    normalizeTimings({ analyze: -1, render: Number.NaN, store: Number.NEGATIVE_INFINITY }),
    undefined
  )
})
