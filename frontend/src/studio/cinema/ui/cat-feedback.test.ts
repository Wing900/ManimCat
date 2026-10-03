import { describe, expect, it } from 'vitest'
import { readStudioCinemaCatFeedback, readStudioCinemaCatTransition } from './cat-feedback'

describe('readStudioCinemaCatFeedback', () => {
  it('maps every working state to a short transient bubble', () => {
    expect(readStudioCinemaCatFeedback('studio.cinema.catSubmitting').bubbleKey).toBe('studio.cinema.catBubbleStart')
    expect(readStudioCinemaCatFeedback('studio.cinema.catWorking').bubbleKey).toBe('studio.cinema.catBubbleWorking')
    expect(readStudioCinemaCatFeedback('studio.cinema.catSubmitting').kind).toBe('transient')
  })

  it('maps every failure or recovery state to a persistent bubble with a recover entry', () => {
    const failed = readStudioCinemaCatFeedback('studio.cinema.catFailed')
    expect(failed.kind).toBe('persistent')
    expect(failed.hasRecoverEntry).toBe(true)
    expect(readStudioCinemaCatFeedback('studio.cinema.catNeedsCheck').hasRecoverEntry).toBe(true)
    expect(readStudioCinemaCatFeedback('studio.cinema.catUnreachable').hasRecoverEntry).toBe(true)
    expect(readStudioCinemaCatFeedback('studio.cinema.catRefreshPaused').hasRecoverEntry).toBe(true)
  })

  it('keeps a reconnect as persistent but without a recover entry (the cat is handling it)', () => {
    const reconnect = readStudioCinemaCatFeedback('studio.cinema.catReconnecting')
    expect(reconnect.kind).toBe('persistent')
    expect(reconnect.hasRecoverEntry).toBe(false)
  })

  it('rests on idle with a faint, fast-fading bubble', () => {
    expect(readStudioCinemaCatFeedback('studio.cinema.catIdle').kind).toBe('resting')
  })
})

describe('readStudioCinemaCatTransition', () => {
  it('announces done only on a working → idle transition with no failed outcome', () => {
    expect(readStudioCinemaCatTransition('studio.cinema.catWorking', 'studio.cinema.catIdle', false)?.bubbleKey).toBe(
      'studio.cinema.catBubbleDone',
    )
    expect(readStudioCinemaCatTransition('studio.cinema.catSubmitting', 'studio.cinema.catIdle', false)?.bubbleKey).toBe(
      'studio.cinema.catBubbleDone',
    )
  })

  it('never announces done when the outcome failed', () => {
    expect(readStudioCinemaCatTransition('studio.cinema.catWorking', 'studio.cinema.catIdle', true)).toBeNull()
  })

  it('never announces done from a non-working previous state', () => {
    expect(readStudioCinemaCatTransition('studio.cinema.catIdle', 'studio.cinema.catIdle', false)).toBeNull()
    expect(readStudioCinemaCatTransition(null, 'studio.cinema.catIdle', false)).toBeNull()
  })
})