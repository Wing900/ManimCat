import { afterEach, describe, expect, it } from 'vitest'
import { scrollIntoViewSoftly } from './scroll-into-view'

interface FakeScrollTarget {
  scrollIntoView?: (options?: boolean | ScrollIntoViewOptions) => void
}

function fakeElement(scrollIntoView?: (options?: boolean | ScrollIntoViewOptions) => void): Element {
  return { scrollIntoView } as unknown as Element
}

describe('scrollIntoViewSoftly', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('scrolls smoothly instead of jumping', () => {
    const calls: Array<ScrollIntoViewOptions | boolean | undefined> = []
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia

    scrollIntoViewSoftly(
      fakeElement((options) => {
        calls.push(options)
      }),
    )

    expect(calls).toEqual([{ behavior: 'smooth', block: 'nearest', inline: 'nearest' }])
  })

  it('keeps the instant jump when the user asked for reduced motion', () => {
    const calls: Array<ScrollIntoViewOptions | boolean | undefined> = []
    window.matchMedia = ((query: string) => ({ matches: true, media: query })) as unknown as typeof window.matchMedia

    scrollIntoViewSoftly(
      fakeElement((options) => {
        calls.push(options)
      }),
    )

    expect(calls).toEqual([{ behavior: 'auto', block: 'nearest', inline: 'nearest' }])
  })

  it('is a no-op for a missing element and where there is no scrollIntoView (jsdom has neither)', () => {
    const target: FakeScrollTarget = {}

    expect(() => scrollIntoViewSoftly(null)).not.toThrow()
    expect(() => scrollIntoViewSoftly(undefined)).not.toThrow()
    expect(() => scrollIntoViewSoftly(target as Element)).not.toThrow()
  })
})
