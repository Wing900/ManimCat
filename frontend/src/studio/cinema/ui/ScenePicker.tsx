import { useEffect, useRef } from 'react'
import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import { readStudioCinemaSceneStatusKey } from './cinema-labels'
import type { StudioCinemaSceneIndexEntry } from '../scene-selectors'

/**
 * ScenePicker (doc §5): the "all scenes" grid.
 *
 * The inline strip is capped at six Scenes; beyond that (or when width is tight) the strip collapses
 * to the current Scene plus this grid's entry, so every Scene stays reachable at any count — never
 * only via prev/next. Each cell shows the Scene's index, name, a light status and a placeholder tile
 * (a real result thumbnail is out of scope until the index carries per-Scene media; the doc allows a
 * placeholder when there is no result).
 *
 * Pure presentational: it never loads a Scene, never subscribes; selection is delegated to the
 * caller's `onSelect`, and Escape closes.
 */

export interface ScenePickerProps {
  entries: readonly StudioCinemaSceneIndexEntry[]
  onSelect: (sceneId: string) => void
  onClose: () => void
}

export function ScenePicker({ entries, onSelect, onClose }: ScenePickerProps) {
  const { t } = useI18n()
  const firstRef = useRef<HTMLButtonElement | null>(null)

  // Opening the grid moves focus into it; closing returns focus to the caller (the strip's button).
  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('studio.cinema.scenePickerLabel')}
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-bg-primary shadow-2xl dark:border-white/15"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
          <h2 className="text-base font-medium text-text-primary/85">{t('studio.cinema.scenePickerLabel')}</h2>
          <button
            type="button"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-black/10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 dark:border-white/15"
            aria-label={t('studio.cinema.scenePickerClose')}
            onClick={onClose}
          >
            {t('studio.cinema.scenePickerClose')}
          </button>
        </header>
        <ul className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
          {entries.map((entry, index) => {
            const statusKey: TranslationKey = readStudioCinemaSceneStatusKey(entry)
            const label = t('studio.cinema.sceneLabel', { index: entry.position + 1 })
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  ref={index === 0 ? firstRef : undefined}
                  className={`flex h-full w-full flex-col items-stretch gap-2 rounded-2xl p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                    entry.isSelected
                      ? 'bg-bg-tertiary/60 dark:bg-white/10'
                      : 'bg-bg-secondary/60 hover:bg-bg-secondary dark:bg-white/5 dark:hover:bg-white/10'
                  }`}
                  aria-current={entry.isSelected ? 'true' : undefined}
                  onClick={() => onSelect(entry.id)}
                >
                  <div
                    className={`flex aspect-video w-full items-center justify-center rounded-lg ${
                      entry.hasFailedOutcome
                        ? 'bg-red-500/10 text-red-500/70'
                        : entry.isBusy
                          ? 'bg-accent/10 text-accent/70'
                          : 'bg-black/5 text-text-secondary/40 dark:bg-white/10'
                    }`}
                    aria-hidden="true"
                  >
                    <span className="text-sm">{t('studio.cinema.scenePickerPlaceholder')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-base font-medium text-text-primary/85">{label}</span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        entry.isBusy ? 'bg-accent' : entry.hasFailedOutcome ? 'bg-red-500/70' : 'bg-text-secondary/30'
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <span className="text-sm text-text-secondary/60">{t(statusKey)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}