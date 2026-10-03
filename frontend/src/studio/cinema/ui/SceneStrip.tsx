import { useState, type KeyboardEvent } from 'react'
import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import { readStudioCinemaSceneStatusKey } from './cinema-labels'
import type { StudioCinemaSceneIndexEntry } from '../scene-selectors'
import { ScenePicker } from './ScenePicker'

/**
 * Scene strip (doc §5): the ordered Scenes of this Session, plus the append action.
 *
 * Moved from below the stage to above it (doc §3.1). Each Scene is a tab; a background Scene shows
 * its *last known* state, never a fake "live" marker, because only the selected Scene has an event
 * stream. Selecting a Scene never stops a background Run and never auto-plays media.
 *
 * Direct selection at any count: when there are six or fewer Scenes every one is inline; beyond six
 * the strip collapses to the current Scene plus the "all scenes" entry, which opens the `ScenePicker`
 * grid so any Scene is reachable without prev/next.
 *
 * Keyboard (doc §5): the tablist implements arrow-key, Home and End focus movement with automatic
 * activation — focus and selection move together — and `aria-selected` reflects the controller's
 * selection, never a local guess.
 */

export interface SceneStripProps {
  entries: readonly StudioCinemaSceneIndexEntry[]
  mutationPending: boolean
  panelId: string
  onSelect: (sceneId: string) => void
  onAppend: () => void
}

const INLINE_LIMIT = 6

export function SceneStrip({ entries, mutationPending, panelId, onSelect, onAppend }: SceneStripProps) {
  const { t } = useI18n()
  const [pickerOpen, setPickerOpen] = useState(false)

  const compact = entries.length > INLINE_LIMIT
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
    // The current tab is the focused one (focus follows the arrows); fall back to the controller's
    // selection, then to the first Scene, so the row is never stuck.
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
    // Move DOM focus synchronously so the next keydown lands on the new tab; the node is stable
    // (keyed by Scene id), so the React re-render keeps focus.
    const tab = nextId ? document.getElementById(`cinema-scene-tab-${nextId}`) : null
    tab?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveFocus('next')
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveFocus('prev')
        break
      case 'Home':
        event.preventDefault()
        moveFocus('first')
        break
      case 'End':
        event.preventDefault()
        moveFocus('last')
        break
      default:
        break
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
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
              className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 text-base transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/40 ${
                entry.isSelected
                  ? 'bg-accent-rgb/10 text-text-primary/90 ring-1 ring-accent-rgb/40'
                  : 'text-text-secondary/75 hover:opacity-80'
              }`}
              onClick={() => onSelect(entry.id)}
            >
              <span>{t('studio.cinema.sceneLabel', { index: entry.position + 1 })}</span>
              <span
                className={`h-2 w-2 rounded-full ${
                  entry.isBusy ? 'bg-accent-rgb' : entry.hasFailedOutcome ? 'bg-red-500/70' : 'bg-text-secondary/30'
                }`}
                aria-hidden="true"
              />
              <span className="sr-only">{t(statusKey)}</span>
            </button>
          )
        })}

        {compact ? (
          <button
            type="button"
            className="flex min-h-[44px] shrink-0 items-center rounded-lg border border-black/10 px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/40 dark:border-white/15"
            onClick={() => setPickerOpen(true)}
          >
            {t('studio.cinema.scenePickerAll', { count: entries.length })}
          </button>
        ) : null}

        <button
          type="button"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-black/10 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/40 disabled:opacity-40 dark:border-white/15"
          aria-label={t('studio.cinema.sceneAppend')}
          disabled={mutationPending}
          onClick={onAppend}
        >
          {t('studio.cinema.sceneAppendShort')}
        </button>
      </div>

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