import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useExitingLayer } from './use-exiting-layer'

const EXIT_MS = 380

function Harness({ layerKey, value }: { layerKey: string; value: string }) {
  const exiting = useExitingLayer(layerKey, value, EXIT_MS)
  return (
    <div>
      <span data-testid="live">{value}</span>
      <span data-testid="exiting">{exiting ?? '-'}</span>
    </div>
  )
}

const readExiting = () => screen.getByTestId('exiting').textContent

describe('useExitingLayer', () => {
  it('puts nothing on stage for the first card', () => {
    render(<Harness layerKey="a" value="a" />)
    expect(readExiting()).toBe('-')
  })

  it('keeps the previous value on stage until the exit is over', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Harness layerKey="a" value="a" />)
    rerender(<Harness layerKey="b" value="b" />)
    expect(readExiting()).toBe('a')

    act(() => {
      vi.advanceTimersByTime(EXIT_MS - 1)
    })
    expect(readExiting()).toBe('a')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(readExiting()).toBe('-')
    vi.useRealTimers()
  })

  it('does not let a live update of the value cancel the exit', () => {
    // The card that is leaving must still go away when the arriving card keeps updating.
    vi.useFakeTimers()
    const { rerender } = render(<Harness layerKey="a" value="a" />)
    rerender(<Harness layerKey="b" value="b1" />)
    expect(readExiting()).toBe('a')

    rerender(<Harness layerKey="b" value="b2" />)
    expect(readExiting()).toBe('a')

    act(() => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    expect(readExiting()).toBe('-')
    vi.useRealTimers()
  })
})
