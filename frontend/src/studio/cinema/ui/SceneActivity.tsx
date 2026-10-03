import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n'
import type { TranslationKey } from '../../../i18n/messages'
import type { StudioTokenUsage } from '../../protocol/studio-agent-types'
import { formatStudioCinemaElapsed, readStudioCinemaTokenSummary } from './cinema-labels'

/**
 * The activity strip (task 11C2): what this Scene's task is doing right now, plus time and tokens.
 *
 * The elapsed clock exists only for display and only while a Run is active, and it is cleared on
 * unmount. A token total the backend never measured is reported as unmeasured, never as `0`.
 */

export interface SceneActivityProps {
  sceneIndex: number
  runStatusKey: TranslationKey | null
  activeRunStartedAt: string | null
  usage: StudioTokenUsage | null
}

export function SceneActivity({ sceneIndex, runStatusKey, activeRunStartedAt, usage }: SceneActivityProps) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!activeRunStartedAt) {
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeRunStartedAt])

  const elapsed = activeRunStartedAt ? formatStudioCinemaElapsed(activeRunStartedAt, now) : ''
  const tokens = readStudioCinemaTokenSummary(usage)

  return (
    <div className="flex shrink-0 items-center gap-3 text-[11px] text-text-secondary/65">
      <span>{t('studio.cinema.sceneLabel', { index: sceneIndex + 1 })}</span>
      <span aria-hidden="true">·</span>
      <span>{runStatusKey ? t(runStatusKey) : t('studio.cinema.activityIdle')}</span>
      {elapsed ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{elapsed}</span>
        </>
      ) : null}
      <span aria-hidden="true">·</span>
      <span>
        {tokens.measured
          ? `${t('studio.cinema.activityTokens')} ${tokens.totalTokens}`
          : `${t('studio.cinema.activityTokens')} ${t('studio.cinema.activityTokensUnmeasured')}`}
      </span>
    </div>
  )
}
