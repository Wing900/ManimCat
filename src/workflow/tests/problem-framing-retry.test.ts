import assert from 'node:assert/strict'
import test from 'node:test'
import { executeProblemFramingWithImageFallback } from '../problem-framing/retry'

test('does not retry when no reference image was submitted', async () => {
  let calls = 0
  const result = await executeProblemFramingWithImageFallback({
    hasReferenceImages: false,
    execute: async () => {
      calls += 1
      throw new Error('provider failed')
    },
    shouldRetryWithoutImages: () => true,
  }).catch((error: unknown) => error)

  assert.equal(calls, 1)
  assert.equal((result as Error).message, 'provider failed')
})

test('retries exactly once without images for an image capability error', async () => {
  const usesImages: boolean[] = []
  const result = await executeProblemFramingWithImageFallback({
    hasReferenceImages: true,
    execute: async (useImages) => {
      usesImages.push(useImages)
      if (useImages) {
        throw new Error('vision unsupported')
      }
      return 'text-only result'
    },
    shouldRetryWithoutImages: (error) => error instanceof Error && error.message === 'vision unsupported',
  })

  assert.equal(result, 'text-only result')
  assert.deepEqual(usesImages, [true, false])
})

test('preserves a non-retriable provider error', async () => {
  const original = new Error('rate limited')
  let calls = 0

  await assert.rejects(
    () => executeProblemFramingWithImageFallback({
      hasReferenceImages: true,
      execute: async () => {
        calls += 1
        throw original
      },
      shouldRetryWithoutImages: () => false,
    }),
    (error: unknown) => error === original,
  )
  assert.equal(calls, 1)
})
