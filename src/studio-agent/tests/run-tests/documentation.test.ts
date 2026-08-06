import assert from 'node:assert/strict'
import {
  createEmptyStudioDocumentationContextProvider,
  loadStudioDocumentationContext,
  type StudioDocumentationContextProvider,
} from '../../index'
import { run } from './factories'

export async function runDocumentationTests(): Promise<void> {
  await run('documentation context is bounded and keeps provider failures optional', async () => {
    const calls: Array<{ kind: string; query: string; maxChars: number }> = []
    const provider: StudioDocumentationContextProvider = {
      async getContext(input) {
        calls.push(input)
        return `  ${'x'.repeat(100)}  `
      }
    }

    const context = await loadStudioDocumentationContext(provider, {
      kind: 'manim',
      query: 'draw a circle',
      maxChars: 24,
    })

    assert.equal(context.length, 24)
    assert.deepEqual(calls, [{ kind: 'manim', query: 'draw a circle', maxChars: 24 }])

    const failed = await loadStudioDocumentationContext({
      async getContext() {
        throw new Error('crawler unavailable')
      }
    }, {
      kind: 'plot',
      query: 'draw a chart',
      maxChars: 100,
    })
    assert.equal(failed, '')
    assert.equal(await createEmptyStudioDocumentationContextProvider().getContext({
      kind: 'plot',
      query: 'anything',
      maxChars: 10,
    }), '')
  })
}
