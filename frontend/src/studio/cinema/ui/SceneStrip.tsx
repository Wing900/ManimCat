import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import type { StudioKind } from '../../protocol/studio-agent-types'
import { cinemaUnitKey } from './cinema-copy'
import { readStudioCinemaSceneStatusKey } from './cinema-labels'
import type { StudioCinemaSceneIndexEntry } from '../scene-selectors'
import { ScenePicker } from './ScenePicker'
import { ChevronLeftIcon, ChevronRightIcon } from './CinemaIcons'
import { scrollIntoViewSoftly } from './scroll-into-view'
import { usePresence } from './use-presence'

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
  studioKind: StudioKind
  mutationPending: boolean
  panelId: string
  onSelect: (sceneId: string) => void
  onAppend: () => void
}

const INLINE_LIMIT = 6
/** Below this many pixels per Scene the strip collapses even with ≤6 Scenes (narrow viewports). */
const MIN_PX_PER_SCENE = 90

export function SceneStrip({ entries, studioKind, mutationPending, panelId, onSelect, onAppend }: SceneStripProps) {
  const { t } = useI18n()
  const [pickerOpen, setPickerOpen] = useState(false)
  // The grid is kept mounted while it fades out; closing is instant to a screen reader either way.
  const pickerPresence = usePresence(pickerOpen, 200)
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
  // In compact mode the row carries only the current Scene, so a pair of arrow buttons flanks the
  // strip and steps to the previous/next Scene directly — no need to open the grid for one hop.
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entry.isSelected))
  const previousEntry = compact && selectedIndex > 0 ? entries[selectedIndex - 1] : null
  const nextEntry = compact && selectedIndex < entries.length - 1 ? entries[selectedIndex + 1] : null
  // In compact mode only the selected Scene stays inline; when none is selected (the brief moment
  // before the controller applies a choice) the first Scene stands in so the row is never empty.
  const inlineEntries = compact
    ? entries.filter((entry) => entry.isSelected).slice(0, 1).length > 0
      ? entries.filter((entry) => entry.isSelected)
      : entries.slice(0, 1)
    : entries

  // The selection pill slides between tabs instead of cross-fading: this row is a segmented control,
  // and a moving pill is what shows which Scene the stage is turning to. Measured in a layout effect
  // (before paint, so the first pill never slides in from nowhere). Inside the scroll container the
  // pill and the tabs share one coordinate system, so scrolling needs no listener.
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [pill, setPill] = useState<{ left: number; width: number; height: number } | null>(null)
  const inlineIds = inlineEntries.map((entry) => entry.id).join('\u0000')
  const selectedInlineId = inlineEntries.find((entry) => entry.isSelected)?.id ?? null
  useLayoutEffect(() => {
    const tab = !compact && selectedInlineId ? tabRefs.current.get(selectedInlineId) : null
    if (!tab) {
      setPill(null)
      return
    }
    setPill({ left: tab.offsetLeft, width: tab.offsetWidth, height: tab.offsetHeight })
  }, [compact, inlineIds, selectedInlineId, availableWidth])

  // The strip follows the stage as well: a Scene that is selected while its tab sits off-screen
  // scrolls in rather than jumping, so the pill and the row stay in step.
  useEffect(() => {
    scrollIntoViewSoftly(selectedInlineId ? tabRefs.current.get(selectedInlineId) : null)
  }, [selectedInlineId])

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
      {compact ? (
        <button
          type="button"
          className="studio-fade-in flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary/70 transition-colors hover:bg-bg-tertiary/50 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
          aria-label={t(cinemaUnitKey(studioKind, 'scenePrev'))}
          disabled={previousEntry === null}
          onClick={() => {
            if (previousEntry) {
              onSelect(previousEntry.id)
            }
          }}
        >
          <ChevronLeftIcon />
        </button>
      ) : null}
      <div
        className="relative flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-x-auto"
        role="tablist"
        aria-label={t(cinemaUnitKey(studioKind, 'sceneStripLabel'))}
        onKeyDown={handleKeyDown}
      >
        {pill ? (
          <span
            aria-hidden="true"
            className="studio-selection-pill pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-bg-tertiary/60 transition-[left,width] duration-[340ms] ease-move dark:bg-white/10"
            style={{ left: pill.left, width: pill.width, height: pill.height }}
          />
        ) : null}
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
              ref={(node) => {
                if (node) {
                  tabRefs.current.set(entry.id, node)
                } else {
                  tabRefs.current.delete(entry.id)
                }
              }}
              className={`studio-fade-in relative flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                entry.isSelected ? 'text-text-primary' : 'text-text-secondary/70 hover:bg-bg-tertiary/35'
              }`}
              onClick={() => onSelect(entry.id)}
            >
              <span>{t(cinemaUnitKey(studioKind, 'sceneLabel'), { index: entry.position + 1 })}</span>
              <span className="sr-only">{t(statusKey)}</span>
            </button>
          )
        })}

        {compact ? (
          <button
            type="button"
            className="studio-fade-in flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-base text-text-secondary/70 transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            onClick={() => setPickerOpen(true)}
          >
            {t(cinemaUnitKey(studioKind, 'scenePickerAll'), { count: entries.length })}
          </button>
        ) : null}
      </div>

      {compact ? (
        <button
          type="button"
          className="studio-fade-in flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary/70 transition-colors hover:bg-bg-tertiary/50 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
          aria-label={t(cinemaUnitKey(studioKind, 'sceneNext'))}
          disabled={nextEntry === null}
          onClick={() => {
            if (nextEntry) {
              onSelect(nextEntry.id)
            }
          }}
        >
          <ChevronRightIcon />
        </button>
      ) : null}

      <button
        type="button"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-base text-text-secondary/70 transition-colors hover:bg-bg-tertiary/50 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
        aria-label={t(cinemaUnitKey(studioKind, 'sceneAppend'))}
        disabled={mutationPending}
        onClick={onAppend}
      >
        {t('studio.cinema.sceneAppendShort')}
      </button>

      {pickerPresence.mounted ? (
        <ScenePicker
          entries={entries}
          studioKind={studioKind}
          exiting={!pickerOpen}
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