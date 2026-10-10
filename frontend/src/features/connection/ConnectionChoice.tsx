import { useI18n } from '../../shared/i18n/index'
import type { ConnectionMode } from './connection-types'

interface ConnectionChoiceProps {
  onSelect: (mode: ConnectionMode) => void
}

interface ChoiceCard {
  mode: ConnectionMode
  titleKey: 'connection.choice.catkey.title' | 'connection.choice.byok.title'
  descKey: 'connection.choice.catkey.desc' | 'connection.choice.byok.desc'
}

const CARDS: ChoiceCard[] = [
  { mode: 'catkey', titleKey: 'connection.choice.catkey.title', descKey: 'connection.choice.catkey.desc' },
  { mode: 'byok', titleKey: 'connection.choice.byok.title', descKey: 'connection.choice.byok.desc' },
]

export function ConnectionChoice({ onSelect }: ConnectionChoiceProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-medium tracking-tight text-text-primary">{t('connection.gate.title')}</h2>
        <p className="text-sm text-text-secondary/70">{t('connection.gate.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <div
            key={card.mode}
            className="flex flex-col gap-4 rounded-3xl border border-bg-tertiary/30 bg-bg-primary/40 p-6"
          >
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-text-primary">{t(card.titleKey)}</h3>
              <p className="text-sm leading-relaxed text-text-secondary/70">{t(card.descKey)}</p>
            </div>
            <button
              type="button"
              onClick={() => onSelect(card.mode)}
              className="mt-auto w-full rounded-2xl bg-accent px-6 py-3 text-sm font-medium text-bg-primary shadow-md shadow-accent/10 transition-all hover:bg-accent/90 active:scale-95"
            >
              {t('connection.choice.select')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
