import { useEffect, useRef } from 'react'
import { useI18n } from '../../../../i18n'
import type { StudioCommandSuggestion } from '../../autocomplete/command-suggestions'

interface StudioCommandAutocompleteProps {
  suggestions: StudioCommandSuggestion[]
  activeIndex: number
  onSelect: (suggestion: StudioCommandSuggestion) => void
}

export function StudioCommandAutocomplete({
  suggestions,
  activeIndex,
  onSelect,
}: StudioCommandAutocompleteProps) {
  const { t } = useI18n()
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const activeItem = itemRefs.current[activeIndex]
    if (typeof activeItem?.scrollIntoView === 'function') {
      activeItem.scrollIntoView({
        block: 'nearest',
      })
    }
  }, [activeIndex, suggestions])

  if (suggestions.length === 0) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-3 overflow-hidden rounded-[1.7rem] border border-black/8 bg-[#fbfaf6]/96 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-bg-secondary/92">
      <div className="flex items-center justify-between border-b border-black/6 px-4 py-3 dark:border-white/8">
        <span className="font-mono text-[10px] uppercase tracking-[0.34em] text-text-secondary/45">
          {t('studio.commandMenu.title')}
        </span>
        <span className="text-[11px] text-text-secondary/48">
          {t('studio.commandMenu.hint')}
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto px-2 py-2">
        {suggestions.map((suggestion, index) => {
          const isActive = index === activeIndex
          return (
            <button
              key={suggestion.id}
              ref={(node) => {
                itemRefs.current[index] = node
              }}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(suggestion)
              }}
              className={`flex w-full items-start justify-between gap-4 rounded-[1.2rem] px-3 py-3 text-left transition-all ${
                isActive
                  ? 'bg-black/[0.06] dark:bg-white/[0.08]'
                  : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[12px] font-semibold tracking-[0.08em] text-text-primary">
                    {suggestion.trigger}
                  </span>
                  <span className="truncate text-[13px] text-text-primary/78">
                    {t(suggestion.titleKey as never)}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-6 text-text-secondary/68">
                  {t(suggestion.descriptionKey as never)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-black/[0.04] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.24em] text-text-secondary/55 dark:bg-white/[0.06]">
                {suggestion.group}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
