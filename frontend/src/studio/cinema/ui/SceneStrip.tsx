import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import { readStudioCinemaSceneStatusKey } from './cinema-labels'
import type { StudioCinemaSceneIndexEntry } from '../scene-selectors'

/**
 * Scene strip (task 11C2): the ordered Scenes of this Session, plus the append action.
 *
 * Each Scene is a tab; a background Scene shows its *last known* state, never a fake "live" marker,
 * because only the selected Scene has an event stream. Selecting a Scene never stops a background Run
 * and never auto-plays media.
 */

export interface SceneStripProps {
  entries: readonly StudioCinemaSceneIndexEntry[]
  mutationPending: boolean
  panelId: string
  onSelect: (sceneId: string) => void
  onAppend: () => void
}

export function SceneStrip({ entries, mutationPending, panelId, onSelect, onAppend }: SceneStripProps) {
  const { t } = useI18n()

  return (
    <div className="flex items-center gap-1 border-t border-black/5 px-3 py-2 dark:border-white/10">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label={t('studio.cinema.sceneStripLabel')}
      >
        {entries.map((entry) => {
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
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 ${
                entry.isSelected ? 'bg-accent-rgb/10 text-text-primary/90' : 'text-text-secondary/70 hover:opacity-80'
              }`}
              onClick={() => onSelect(entry.id)}
            >
              <span>{t('studio.cinema.sceneLabel', { index: entry.position + 1 })}</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  entry.isBusy ? 'bg-accent-rgb' : entry.hasFailedOutcome ? 'bg-red-500/70' : 'bg-text-secondary/30'
                }`}
                aria-hidden="true"
              />
              <span className="sr-only">{t(statusKey)}</span>
            </button>
          )
        })}

        <button
          type="button"
          className="shrink-0 rounded-lg border border-black/10 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 disabled:opacity-40 dark:border-white/15"
          aria-label={t('studio.cinema.sceneAppend')}
          disabled={mutationPending}
          onClick={onAppend}
        >
          {t('studio.cinema.sceneAppendShort')}
        </button>
      </div>
    </div>
  )
}
