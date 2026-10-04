import { useLayoutEffect, useRef } from 'react'

/**
 * Which way the studio's content is moving (doc §3.1 stage + §5 strip).
 *
 * One rule, taken from the shape of the data: a different Session is a different *card* — it comes
 * from the session list, so it slides on the vertical axis. A different Scene inside the same Session
 * is a different *page* of the same card — it comes from the scene strip, so it slides on the
 * horizontal axis. Nothing else moves (the sidebar, the composer and the cat stay put).
 *
 * The direction follows the list order, so switching down a list reads like scrolling a feed: the
 * next card rises into place, the previous one comes back down.
 */

export type StudioCinemaContentAxis = 'session' | 'scene'

export interface StudioCinemaContentSlide {
  /** What changed this render: a Session, a Scene inside it, or nothing. */
  axis: StudioCinemaContentAxis | null
  /** forward = a later entry of its list. */
  direction: 'forward' | 'backward'
}

export interface StudioCinemaContentPosition {
  sessionId: string | null
  sceneId: string | null
  /** Index of this Session in the session list; -1 when it is not listed (then forward). */
  sessionOrder: number
  /** Index of this Scene in the scene list; -1 when it is not listed (then forward). */
  sceneOrder: number
}

export function readStudioCinemaContentSlide(
  previous: StudioCinemaContentPosition | null,
  current: StudioCinemaContentPosition,
): StudioCinemaContentSlide {
  if (!previous || previous.sessionId === null) {
    return { axis: null, direction: 'forward' }
  }
  if (current.sessionId !== previous.sessionId) {
    return { axis: 'session', direction: readDirection(current.sessionOrder, previous.sessionOrder) }
  }
  if (current.sceneId !== previous.sceneId) {
    return { axis: 'scene', direction: readDirection(current.sceneOrder, previous.sceneOrder) }
  }
  return { axis: null, direction: 'forward' }
}

/** A missing order (-1: not in the list) never reverses the motion — it falls forward. */
function readDirection(currentOrder: number, previousOrder: number): 'forward' | 'backward' {
  if (currentOrder < 0 || previousOrder < 0) {
    return 'forward'
  }
  return currentOrder >= previousOrder ? 'forward' : 'backward'
}

export function useStudioCinemaContentSlide(position: StudioCinemaContentPosition): StudioCinemaContentSlide {
  const previousRef = useRef<StudioCinemaContentPosition | null>(null)
  // Read the previous position during the render (the animation class has to be on this frame's
  // markup), commit this one afterwards. No state update, so the slide never costs a second render.
  const slide = readStudioCinemaContentSlide(previousRef.current, position)
  useLayoutEffect(() => {
    previousRef.current = position
  })
  return slide
}
