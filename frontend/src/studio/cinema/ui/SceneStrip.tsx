import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import { readStudioCinemaSceneStatusKey } from './cinema-labels'
import type { StudioCinemaSceneIndexEntry } from '../scene-selectors'
import { ScenePicker } from './ScenePicker'

/**
 * Scene strip (doc §5): the ordered Scenes of this Session, plus the append action.
 *
 * Moved from below the stage to above it (doc §3.1), centred above the stage. Each Scene is a tab;
 * a background Scene shows its *last known* state, never a fake "live" marker. Selecting a Scene
 * never stops a background Run and never auto-plays media.
 *
 * Direct selection at any count: when there is room every Scene is inline; the strip collapses to the
 * current Scene plus the "all scenes" entry when there are more than six Scenes OR the strip is too
 * narrow for one tab per ~90px (a single ResizeObserver on the root, not a window listener). The
 * "all scenes" entry opens the `ScenePicker` grid so any Scene is reachable without prev/next.
 *
 * The append button stays OUTSIDE the scroll area so it is always reachable, even when the tabs
 * scroll. Keyboard (doc §5): in inline mode the tablist implements Arrow/Home/End with automatic
 * activation; in compact mode those keys open the grid (the inline row has only the current Scene).
 */

export interface SceneStripProps {
  entries: readonly StudioCinemaSceneIndexEntry[]
  mutationPending: boolean
  panelId: string
  onSelect: (sceneId: string) => void
  onAppend: () => void
}

const INLINE_LIMIT = 6
/** Below this many pixels per Scene the strip collapses even with ≤6 Scenes (narrow viewports). */
const MIN_PX_PER_SCENE = 90

export function SceneStrip({ entries, mutationPending, panelId, onSelect, onAppend }: SceneStripProps) {
  const { t } = useI18n()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [availableWidth, setAvailableWidth] = useState(Number.POSITIVE_INFINITY)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // One ResizeObserver on the root (container width, not a window listener — doc §5). The width is
  // stable: it does not depend on whether the strip is collapsed, so there is no oscillation.
  useEffect(() => {
    const element = rootRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const compact =
    entries.length > INLINE_LIMIT || (entries.length > 1 && availableWidth / entries.length < MIN_PX_PER_SCENE)
  // In compact mode only the selected Scene stays inline; when none is selected (the brief moment
  // before the controller applies a choice) the first Scene stands in so the row is never empty.
  const inlineEntries = compact
    ? entries.filter((entry) => entry.isSelected).slice(0, 1).length > 0
      ? entries.filter((entry) => entry.isSelected)
      : entries.slice(0, 1)
    : entries

  const moveFocus = (direction: 'next' | 'prev' | 'first' | 'last') => {
    const ids = entries.map((entry) => entry.id)
    if (ids.length === 0) {
      return
    }
    const focusedId = (document.activeElement as HTMLElement | null)?.id?.replace('cinema-scene-tab-', '')
    const selectedId = entries.find((entry) => entry.isSelected)?.id
    const currentId = focusedId && ids.includes(focusedId) ? focusedId : (selectedId ?? ids[0])
    const currentIndex = Math.max(0, ids.indexOf(currentId))
    let nextIndex = currentIndex
    if (direction === 'next') nextIndex = (currentIndex + 1) % ids.length
    if (direction === 'prev') nextIndex = (currentIndex - 1 + ids.length) % ids.length
    if (direction === 'first') nextIndex = 0
    if (direction === 'last') nextIndex = ids.length - 1
    const nextId = ids[nextIndex]
    if (nextId && nextId !== currentId) {
      onSelect(nextId)
    }
    const tab = nextId ? document.getElementById(`cinema-scene-tab-${nextId}`) : null
    tab?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const arrowKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (!arrowKeys.includes(event.key)) {
      return
    }
    event.preventDefault()
    // In compact mode the inline row has only the current Scene; arrows open the grid where every
    // Scene is reachable. Focusing a not-yet-mounted target tab would fail.
    if (compact) {
      setPickerOpen(true)
      return
    }
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        moveFocus('next')
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        moveFocus('prev')
        break
      case 'Home':
        moveFocus('first')
        break
      case 'End':
        moveFocus('last')
        break
      default:
        break
    }
  }

  return (
    <div ref={rootRef} className="flex items-center justify-center gap-2 px-3 py-2">
      <div
        className="flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-x-auto"
        role="tablist"
        aria-label={t('studio.cinema.sceneStripLabel')}
        onKeyDown={handleKeyDown}
      >
        {inlineEntries.map((entry) => {
          const statusKey: TranslationKey = readStudioCinemaSceneStatusKey(entry)
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`cinema-scene-tab-${entry.id}`}
              aria-selected={entry.isSelected}
              aria-controls={panelId}
              tabIndex={entry.isSelected ? 0 : -1}
              className={`flex min-h-[44px] shrink-0 items-center rounded-md px-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 ${
                entry.isSelected
                  ? 'bg-accent-rgb/15 text-text-primary'
                  : 'text-text-secondary/70 hover:bg-bg-tertiary/50'
              }`}
              onClick={() => onSelect(entry.id)}
            >
              <span>{t('studio.cinema.sceneLabel', { index: entry.position + 1 })}</span>
              <span className="sr-only">{t(statusKey)}</span>
            </button>
          )
        })}

        {compact ? (
          <button
            type="button"
            className="flex min-h-[44px] shrink-0 items-center rounded-md border border-black/10 px-3 text-base transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
            onClick={() => setPickerOpen(true)}
          >
            {t('studio.cinema.scenePickerAll', { count: entries.length })}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-black/10 text-base transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 disabled:opacity-40 dark:border-white/15"
        aria-label={t('studio.cinema.sceneAppend')}
        disabled={mutationPending}
        onClick={onAppend}
      >
        {t('studio.cinema.sceneAppendShort')}
      </button>

      {pickerOpen ? (
        <ScenePicker
          entries={entries}
          onSelect={(sceneId) => {
            setPickerOpen(false)
            onSelect(sceneId)
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}