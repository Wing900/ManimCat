import type { ComponentType, SVGProps } from 'react'
import { useI18n } from '../../shared/i18n/index'
import type { ConnectionMode } from './connection-types'
import { CatKeyIllustration, OwnApiIllustration } from './connection-illustrations'

interface ConnectionChoiceProps {
  onSelect: (mode: ConnectionMode) => void
}

interface ChoiceCard {
  mode: ConnectionMode
  titleKey: 'connection.choice.catkey.title' | 'connection.choice.byok.title'
  descKey: 'connection.choice.catkey.desc' | 'connection.choice.byok.desc'
  Illustration: ComponentType<SVGProps<SVGSVGElement>>
}

const CARDS: ChoiceCard[] = [
  {
    mode: 'catkey',
    titleKey: 'connection.choice.catkey.title',
    descKey: 'connection.choice.catkey.desc',
    Illustration: CatKeyIllustration,
  },
  {
    mode: 'byok',
    titleKey: 'connection.choice.byok.title',
    descKey: 'connection.choice.byok.desc',
    Illustration: OwnApiIllustration,
  },
]

/**
 * The two ways in, as pictures.
 *
 * The whole card is the button — a nested button inside a card would be invalid HTML, and one big
 * target is the friendlier thing anyway. The pill at the bottom is a `<span>` that only looks like a
 * button; the card owns the press.
 *
 * The card reads as a card: it is the one surface in the app that is **not** the guide's paper. The
 * page colour (`bg-primary`) sits under it, and the illustrations bring no paper of their own — the
 * ink just lies on the card, so there is exactly one white on the screen and nothing to disagree with.
 *
 * Feedback is positional, not chromatic: two pixels up on hover, back to the plane (and a hair
 * smaller) on press. A tint would compete with the two pictures, and this screen is about them.
 */
export function ConnectionChoice({ onSelect }: ConnectionChoiceProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-7">
      <h2 className="text-center text-xl font-medium tracking-tight text-text-primary">
        {t('connection.gate.title')}
      </h2>

      <div className="grid gap-5 sm:grid-cols-2">
        {CARDS.map(({ mode, titleKey, descKey, Illustration }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onSelect(mode)}
            className="flex flex-col items-center gap-4 rounded-3xl border border-bg-tertiary/30 bg-bg-primary p-6 text-center transition-transform duration-200 ease-ui hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
          >
            {/* 180×117 就是 400×260 的比例：画和框严丝合缝，四周不留多余的空。 */}
            <Illustration className="h-[117px] w-[180px] text-text-primary" />
            <span className="flex flex-col gap-1.5">
              <span className="text-base font-semibold text-text-primary">{t(titleKey)}</span>
              <span className="text-sm leading-relaxed text-text-secondary/70">{t(descKey)}</span>
            </span>
            <span className="mt-auto w-full rounded-2xl bg-accent px-6 py-3 text-sm font-medium text-bg-primary shadow-md shadow-accent/10">
              {t('connection.choice.select')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
