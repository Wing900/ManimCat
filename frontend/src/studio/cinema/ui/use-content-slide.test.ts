import { describe, expect, it } from 'vitest'
import { readStudioCinemaContentSlide, type StudioCinemaContentPosition } from './use-content-slide'

/**
 * The axis rule (doc §3.1 stage + §5 strip).
 *
 * A different Session is a different *card* — it comes from the session list, so it moves on the
 * vertical axis. A different Scene inside the same Session is a different *page* of that card — it
 * comes from the scene strip, so it moves on the horizontal axis. The direction follows the list
 * order, so switching down a list reads like scrolling a feed.
 */

const position = (
  sessionId: string | null,
  sceneId: string | null,
  sessionOrder = 0,
  sceneOrder = 0,
): StudioCinemaContentPosition => ({ sessionId, sceneId, sessionOrder, sceneOrder })

describe('studio content slide', () => {
  it('does not slide for the first position', () => {
    expect(readStudioCinemaContentSlide(null, position('s1', 'sc1'))).toEqual({
      axis: null,
      direction: 'forward',
    })
  })

  it('does not slide when nothing but the state changed', () => {
    expect(readStudioCinemaContentSlide(position('s1', 'sc1', 0, 0), position('s1', 'sc1', 0, 0))).toEqual({
      axis: null,
      direction: 'forward',
    })
  })

  it('slides vertically for a Session, by the order of the session list', () => {
    expect(readStudioCinemaContentSlide(position('s1', 'sc1', 0, 0), position('s2', 'sc9', 1, 0))).toEqual({
      axis: 'session',
      direction: 'forward',
    })
    expect(readStudioCinemaContentSlide(position('s2', 'sc9', 1, 0), position('s1', 'sc1', 0, 0))).toEqual({
      axis: 'session',
      direction: 'backward',
    })
  })

  it('slides horizontally for a Scene, by the order of the scene list', () => {
    expect(readStudioCinemaContentSlide(position('s1', 'sc1', 0, 0), position('s1', 'sc2', 0, 1))).toEqual({
      axis: 'scene',
      direction: 'forward',
    })
    expect(readStudioCinemaContentSlide(position('s1', 'sc2', 0, 1), position('s1', 'sc1', 0, 0))).toEqual({
      axis: 'scene',
      direction: 'backward',
    })
  })

  it('treats a Session or Scene that is not in its list as forward, never as a reversal', () => {
    expect(readStudioCinemaContentSlide(position('s1', 'sc1', -1, 0), position('s1', 'sc2', -1, -1))).toEqual({
      axis: 'scene',
      direction: 'forward',
    })
    expect(readStudioCinemaContentSlide(position('s1', 'sc1', 0, 0), position('s2', 'sc9', -1, 0))).toEqual({
      axis: 'session',
      direction: 'forward',
    })
  })

  it('treats the first content as no slide, so the entry assembly stays the only entrance', () => {
    expect(readStudioCinemaContentSlide(position(null, null), position('s1', 'sc1'))).toEqual({
      axis: null,
      direction: 'forward',
    })
  })
})
