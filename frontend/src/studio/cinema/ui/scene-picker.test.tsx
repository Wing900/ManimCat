import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import { ScenePicker } from './ScenePicker'
import type { StudioCinemaSceneIndexEntry } from '../scene-selectors'

/**
 * ScenePicker (doc §5): the "all scenes" grid that keeps every Scene reachable at any count.
 *
 * The inline strip is capped at six; beyond that the strip collapses to the current Scene plus this
 * grid's entry, so a workspace with many Scenes still offers direct selection without prev/next.
 */

function entry(id: string, position: number, overrides: Partial<StudioCinemaSceneIndexEntry> = {}): StudioCinemaSceneIndexEntry {
  return {
    id,
    position,
    isSelected: position === 0,
    isBusy: false,
    snapshotStatus: 'idle',
    streamState: 'idle',
    hasFailedOutcome: false,
    needsReconciliation: false,
    ...overrides,
  }
}

function renderPicker(entries: StudioCinemaSceneIndexEntry[], onSelect: (id: string) => void = () => undefined) {
  render(
    <I18nProvider>
      <ScenePicker entries={entries} onSelect={onSelect} onClose={() => undefined} />
    </I18nProvider>,
  )
}

describe('ScenePicker', () => {
  it('renders one selectable button per Scene, in order, with its index and status', () => {
    const entries = [entry('a', 0), entry('b', 1), entry('c', 2)]
    renderPicker(entries)

    const buttons = screen.getAllByRole('button')
    // Every Scene becomes a button; no Scene is missing.
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText(/Scene 1/)).toBeInTheDocument()
    expect(screen.getByText(/Scene 2/)).toBeInTheDocument()
    expect(screen.getByText(/Scene 3/)).toBeInTheDocument()
  })

  it('selects the clicked Scene and nothing else', () => {
    const entries = [entry('a', 0), entry('b', 1), entry('c', 2)]
    const onSelect = vi.fn()
    renderPicker(entries, onSelect)

    // Click the third Scene's button; only that id is selected.
    const third = screen.getAllByRole('button').find((button) => button.textContent?.includes('Scene 3'))
    expect(third).toBeDefined()
    fireEvent.click(third as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('c')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('marks the current Scene as current for assistive tech', () => {
    const entries = [entry('a', 0, { isSelected: true }), entry('b', 1, { isSelected: false })]
    renderPicker(entries)

    const current = screen.getAllByRole('button').find((button) => button.textContent?.includes('Scene 1'))
    expect(current).toHaveAttribute('aria-current', 'true')
  })
})