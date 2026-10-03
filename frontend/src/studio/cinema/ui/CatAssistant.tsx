import type { Ref } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import { useI18n } from '../../../i18n'
import { CatCharacter, type CatPose } from './CatCharacter'
import { CatSpeechBubble } from './CatSpeechBubble'
import { useStudioCinemaCatFeedback } from './use-cat-feedback'

/**
 * The cat (doc §6, §7): the one entry to the conversation history and the one companion who says a
 * single short sentence about the Scene it stands next to.
 *
 * The brand logo is gone; the cat is the independent `CatCharacter` svg, sized 64–96px so it stays a
 * recognisable character (doc §6: never the 28px badge). It sits at stage right, independent of the
 * stage/composer centre axis (the workspace positions this root absolutely). Opening and closing the
 * history is a user action only: sending, completing or failing never expands the panel.
 *
 * Pose drives `data-pose` on the character; CSS does the idle blink / busy lean and turns them off
 * under `prefers-reduced-motion` (doc §7.3). The bubble is the hook's one short sentence, deduped and
 * scene-isolated; a failure offers "view details", which opens the history where the failure lives.
 */

export interface CatAssistantProps {
  statusKey: TranslationKey
  statusParams?: Record<string, number | string>
  tone: 'idle' | 'busy' | 'warning' | 'error'
  sessionId: string
  sceneId: string
  hasFailedOutcome: boolean
  historyOpen: boolean
  historyPanelId: string
  buttonRef?: Ref<HTMLButtonElement>
  onToggleHistory: () => void
}

const TONE_TO_POSE: Record<CatAssistantProps['tone'], CatPose> = {
  idle: 'idle',
  busy: 'busy',
  warning: 'busy',
  error: 'error',
}

export function CatAssistant({
  statusKey,
  statusParams,
  tone,
  sessionId,
  sceneId,
  hasFailedOutcome,
  historyOpen,
  historyPanelId,
  buttonRef,
  onToggleHistory,
}: CatAssistantProps) {
  const { t } = useI18n()
  const { bubble, visible, onHoverStart, onHoverEnd } = useStudioCinemaCatFeedback({
    statusKey,
    statusParams,
    sessionId,
    sceneId,
    hasFailedOutcome,
  })

  const pose = TONE_TO_POSE[tone]

  return (
    <div className="flex flex-col items-end gap-2">
      {bubble ? (
        <CatSpeechBubble
          bubbleKey={bubble.bubbleKey}
          params={bubble.params}
          visible={visible}
          kind={bubble.kind}
          hasRecoverEntry={bubble.hasRecoverEntry}
          onHoverStart={onHoverStart}
          onHoverEnd={onHoverEnd}
          onRecover={onToggleHistory}
          recoverLabelKey={t('studio.cinema.catRecoverView') as TranslationKey}
        />
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        className="cinema-cat-button group flex h-16 w-16 items-center justify-center rounded-full border border-black/10 bg-bg-primary/80 transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/40 dark:border-white/15 sm:h-24 sm:w-24"
        aria-label={t('studio.cinema.catEntryLabel')}
        aria-expanded={historyOpen}
        aria-controls={historyPanelId}
        onClick={onToggleHistory}
        data-tone={tone}
      >
        <CatCharacter pose={pose} className="cinema-cat-character h-12 w-12 sm:h-20 sm:w-20" />
        <span className="sr-only">
          {historyOpen ? t('studio.cinema.catHistoryHide') : t('studio.cinema.catHistoryShow')}
        </span>
      </button>
    </div>
  )
}