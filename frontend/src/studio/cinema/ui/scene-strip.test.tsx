import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import { SceneStrip } from './SceneStrip'
import type { StudioCinemaSceneIndexEntry } from '../scene-selectors'

function entry(id: string, position: number, selected = false): StudioCinemaSceneIndexEntry {
  return {
    id,
    position,
    isSelected: selected,
    isBusy: false,
    snapshotStatus: 'idle',
    streamState: 'idle',
    hasFailedOutcome: false,
    needsReconciliation: false,
  }
}

function renderStrip(entries: StudioCinemaSceneIndexEntry[], onSelect = () => undefined) {
  render(
    <I18nProvider>
      <SceneStrip entries={entries} mutationPending={false} panelId="p" onSelect={onSelect} onAppend={() => undefined} />
    </I18nProvider>,
  )
}

describe('SceneStrip', () => {
  it('shows every Scene as a tab when there are six or fewer', () => {
    const entries = [entry('a', 0, true), entry('b', 1), entry('c', 2)]
    renderStrip(entries)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('collapses to the current Scene plus the all-scenes entry when there are more than six', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(`s${i}`, i, i === 3))
    renderStrip(entries)
    // Compact mode: only the current Scene stays inline as a tab.
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /Scene 4/ })).toHaveAttribute('aria-selected', 'true')
    // The all-scenes entry is reachable.
    expect(screen.getByRole('button', { name: /All scenes/ })).toBeInTheDocument()
  })

  it('steps to the previous and next Scene with the flanking arrow buttons in compact mode', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(`s${i}`, i, i === 3))
    const onSelect = vi.fn()
    renderStrip(entries, onSelect)

    // The current Scene is index 3 → both steppers are enabled.
    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }))
    expect(onSelect).toHaveBeenLastCalledWith('s2')
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }))
    expect(onSelect).toHaveBeenLastCalledWith('s4')
  })

  it('disables the steppers at the ends of the Scene list', () => {
    renderStrip(Array.from({ length: 8 }, (_, i) => entry(`s${i}`, i, i === 0)))
    expect(screen.getByRole('button', { name: 'Previous scene' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next scene' })).toBeEnabled()
  })

  it('opens the all-scenes grid and selects a Scene from it', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(`s${i}`, i, i === 3))
    const onSelect = vi.fn()
    renderStrip(entries, onSelect)

    fireEvent.click(screen.getByRole('button', { name: /All scenes/ }))
    // The grid dialog appears.
    screen.getByRole('dialog')
    // Click Scene 7 (index 6, id s6) inside the grid.
    fireEvent.click(screen.getByText('Scene 7'))
    expect(onSelect).toHaveBeenCalledWith('s6')
    // The grid closes after a selection.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves focus and selection with ArrowRight, Home and End', () => {
    const entries = [entry('a', 0, true), entry('b', 1), entry('c', 2)]
    const onSelect = vi.fn()
    renderStrip(entries, onSelect)

    const tabs = screen.getAllByRole('tab')
    // Start on the first tab (selected → tabindex 0).
    tabs[0].focus()
    expect(document.activeElement).toBe(tabs[0])

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    // ArrowRight both moves focus and selects the next Scene.
    expect(onSelect).toHaveBeenLastCalledWith('b')

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' })
    expect(onSelect).toHaveBeenLastCalledWith('c')

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
  })
})