import { useEffect, useRef, useState } from 'react'

/**
 * Keeps the card that is leaving on stage while it plays out.
 *
 * The card is kept as a *keyed sibling* in the caller's list, never re-rendered from a stale element.
 * That is the whole point: React reconciles a keyed item, so the DOM nodes inside it — the `<video>`
 * above all — are the ones that were already on screen, and the video keeps the frame it was showing.
 * A replay builds new elements, and a `<video>` that is rebuilt has no data at all: the frame is gone,
 * and until the metadata arrives the element is laid out at the CSS default object size (300×150) — the
 * shrunken black box that used to fly out of a switch and then jump back to the real size.
 *
 * Nothing is put on stage when the change is not one that moves: fast input coalesces, and a settled
 * change (the index landing, a Session filling itself in) is placed without motion.
 */
export function useLeavingCard<TCard extends { key: string }>(
  /** The card this render is showing, or null while the stage has no card at all. */
  card: TCard | null,
  /** Whether this render's change is the one the user made — the only kind that moves. */
  animated: boolean,
  /** How long the exit runs (a little past the slide, so nothing is cut off). */
  exitMs: number,
): TCard | null {
  const previousRef = useRef<TCard | null>(null)
  const [held, setHeld] = useState<TCard | null>(null)

  // Resolved during the render that starts the push, not in an effect: the caller puts this card in
  // *this* render's list, which is what makes React reconcile the node in place. An effect runs after
  // the commit, and by then the card would already have been dropped — a replay, not the same DOM.
  const leaving =
    animated && card !== null && previousRef.current !== null && previousRef.current.key !== card.key
      ? previousRef.current
      : null
  if (card !== null) {
    previousRef.current = card
  }

  const leavingKey = leaving?.key ?? null
  // Remember the card that is leaving. Keyed by the destination that started it, not by the object:
  // the object is rebuilt every render, and re-running this for the same key would be pointless.
  useEffect(() => {
    if (leavingKey === null) {
      return
    }
    setHeld(leaving)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `leavingKey`; the object is new every render
  }, [leavingKey])

  // The exit is timed from the card being held, never from `leaving`: that expression goes back to null
  // on the very next render (the previous card has already been replaced by the arriving one), so a
  // dependency on it would clear the timer the moment it was set.
  useEffect(() => {
    if (held === null) {
      return
    }
    const timer = setTimeout(() => setHeld(null), exitMs)
    return () => clearTimeout(timer)
  }, [held, exitMs])

  // On the render that starts the push `held` is still empty and the card that is leaving is the one
  // this render resolved; every render after that is served by `held`, until it has finished moving.
  // A held card wins over a new one, so an exit that has already started is never replaced mid-flight.
  return held ?? leaving
}
