import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import { LogoUsagePopover } from './LogoUsagePopover'
import type { StudioTokenUsage } from '../../protocol/studio-agent-types'

function usage(overrides: Partial<StudioTokenUsage> = {}): StudioTokenUsage {
  return {
    totalTokens: 1200,
    promptTokens: 400,
    completionTokens: 800,
    measuredCalls: 2,
    unmeasuredCalls: 0,
    ...overrides,
  }
}

function renderPopover(props: Partial<Parameters<typeof LogoUsagePopover>[0]> = {}) {
  render(
    <I18nProvider>
      <LogoUsagePopover usage={usage()} sentRounds={3} sceneLabel="Scene 2" {...props} />
    </I18nProvider>,
  )
}

describe('LogoUsagePopover', () => {
  it('is closed until the logo is focused, then shows the current-scene stats', () => {
    renderPopover()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.focus(screen.getByLabelText('View current scene stats'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog.textContent).toContain('Scene 2')
    expect(dialog.textContent).toContain('Sent rounds')
    // Sent rounds value is rendered.
    expect(dialog.textContent).toContain('3')
  })

  it('never dresses an unmeasured scene as zero tokens', () => {
    renderPopover({ usage: usage({ measuredCalls: 0, unmeasuredCalls: 4, totalTokens: 0, promptTokens: 0, completionTokens: 0 }) })
    fireEvent.focus(screen.getByLabelText('View current scene stats'))
    const dialog = screen.getByRole('dialog')
    // The unmeasured hint appears, not a 0 total dressed up as a real measurement.
    expect(dialog.textContent).toContain('Unmeasured')
    // The token rows are suppressed when nothing was metered, so no 0 total is shown as a value.
    expect(dialog.textContent).not.toContain('Total')
  })

  it('pins open on click and closes on Escape', () => {
    renderPopover()
    const trigger = screen.getByLabelText('View current scene stats')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not steal pointer events from the sidebar: hovering the logo schedules open', () => {
    vi.useFakeTimers()
    try {
      renderPopover()
      const trigger = screen.getByLabelText('View current scene stats')
      fireEvent.mouseEnter(trigger.parentElement as HTMLElement)
      // Before the 200ms hover delay, nothing is shown.
      expect(screen.queryByRole('dialog')).toBeNull()
      act(() => {
        vi.advanceTimersByTime(210)
      })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes a pinned card on outside click (pinned only survives hover-out)', () => {
    renderPopover()
    const trigger = screen.getByLabelText('View current scene stats')
    fireEvent.click(trigger) // pins + opens
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => {
 fireEvent.pointerDown(document.body)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})