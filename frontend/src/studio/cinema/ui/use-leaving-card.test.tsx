import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLeavingCard } from './use-leaving-card'

const EXIT_MS = 380

interface Card {
  key: string
  label: string
}

function Harness({ card, animated = true }: { card: Card | null; animated?: boolean }) {
  const leaving = useLeavingCard(card, animated, EXIT_MS)
  return (
    <div>
      <span data-testid="live">{card?.label ?? '-'}</span>
      <span data-testid="leaving">{leaving?.label ?? '-'}</span>
    </div>
  )
}

const readLeaving = () => screen.getByTestId('leaving').textContent

describe('useLeavingCard', () => {
  it('puts nothing on stage for the first card', () => {
    render(<Harness card={{ key: 'a', label: 'a' }} />)
    expect(readLeaving()).toBe('-')
  })

  it('keeps the card that was on stage until the exit is over', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Harness card={{ key: 'a', label: 'a' }} />)
    rerender(<Harness card={{ key: 'b', label: 'b' }} />)
    // Resolved in the render that starts the push: the caller needs it in that same render, or React
    // would drop the node before it could be kept.
    expect(readLeaving()).toBe('a')

    act(() => {
      vi.advanceTimersByTime(EXIT_MS - 1)
    })
    expect(readLeaving()).toBe('a')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(readLeaving()).toBe('-')
    vi.useRealTimers()
  })

  it('leaves nothing on stage when the change is not a push', () => {
    // Fast input coalesces, and a settled change is placed without motion.
    vi.useFakeTimers()
    const { rerender } = render(<Harness card={{ key: 'a', label: 'a' }} />)
    rerender(<Harness card={{ key: 'b', label: 'b' }} animated={false} />)
    expect(readLeaving()).toBe('-')

    // …and the card on screen is still the one remembered, so the next real push uses that one.
    rerender(<Harness card={{ key: 'c', label: 'c' }} />)
    expect(readLeaving()).toBe('b')
    vi.useRealTimers()
  })

  it('does not let a live update of the arriving card cancel the exit', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Harness card={{ key: 'a', label: 'a' }} />)
    rerender(<Harness card={{ key: 'b', label: 'b1' }} />)
    expect(readLeaving()).toBe('a')

    rerender(<Harness card={{ key: 'b', label: 'b2' }} />)
    expect(readLeaving()).toBe('a')

    act(() => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    expect(readLeaving()).toBe('-')
    vi.useRealTimers()
  })
})
