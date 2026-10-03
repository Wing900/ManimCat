import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import ManimCatLogo from '../../../components/ManimCatLogo'
import type { StudioTokenUsage } from '../../protocol/studio-agent-types'
import { formatStudioTokenCount } from '../../status/format-studio-token-count'

/**
 * LogoUsagePopover (doc §4): the sidebar logo is the entry to the current-Scene stats card.
 *
 * Opened by hover (~200ms), keyboard focus, or click (which pins it open). Clicking outside or
 * pressing Escape closes it. The pointer may move from the logo into the card to read it without the
 * card vanishing; only leaving both starts the close. Touch uses click.
 *
 * The stats are explicitly the *current Scene's* (doc §4): sent rounds = saved user messages of this
 * Scene (failed local submits are never saved, so they are never counted), input/output/total tokens
 * from the Scene's latest Run, and a metering hint that never dresses "unknown" as zero.
 */

export interface LogoUsagePopoverProps {
  usage: StudioTokenUsage | null
  /** Saved user messages of the current Scene (doc §4: failed local submits are not counted). */
  sentRounds: number
  /** Label of the current Scene, e.g. "Scene 2". */
  sceneLabel: string
}

const HOVER_OPEN_DELAY_MS = 200
const HOVER_CLOSE_DELAY_MS = 150

export function LogoUsagePopover({ usage, sentRounds, sceneLabel }: LogoUsagePopoverProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const descriptionId = useId()

  const cancelOpenTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }
  const cancelCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const openNow = () => {
    cancelOpenTimer()
    cancelCloseTimer()
    setOpen(true)
  }
  const scheduleOpen = () => {
    cancelCloseTimer()
    if (open || pinned) {
      return
    }
    openTimerRef.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS)
  }
  const scheduleClose = () => {
    cancelOpenTimer()
    if (!open || pinned) {
      return
    }
    closeTimerRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS)
  }

  // Outside click closes (unless pinned); Escape closes.
  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        // Outside click closes the card even when it was pinned (doc §4); pinned only survives hover-out.
        setPinned(false)
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinned(false)
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    return () => {
      cancelOpenTimer()
      cancelCloseTimer()
    }
  }, [])

  const allUnmeasured = usage ? usage.measuredCalls === 0 && usage.unmeasuredCalls > 0 : false
  const partial = usage ? usage.measuredCalls > 0 && usage.unmeasuredCalls > 0 : false

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/40"
        aria-label={t('studio.cinema.logoUsageLabel')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? descriptionId : undefined}
        onClick={() => {
          setPinned((value) => !value)
          setOpen(true)
        }}
        onFocus={openNow}
        onBlur={scheduleClose}
      >
        <ManimCatLogo className="h-9 w-9 rounded-full" />
      </button>

      {open ? (
        <div
          id={descriptionId}
          role="dialog"
          aria-label={t('studio.cinema.logoUsageTitle')}
          className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-black/10 bg-bg-primary p-3 shadow-xl dark:border-white/15"
          onMouseEnter={cancelCloseTimer}
          onMouseLeave={scheduleClose}
        >
          <div className="mb-2 border-b border-black/5 pb-1.5 dark:border-white/10">
            <p className="text-sm uppercase tracking-wide text-text-secondary/50">{t('studio.cinema.logoUsageScope')}</p>
            <p className="truncate text-base font-medium text-text-primary/85">{sceneLabel}</p>
          </div>

          <dl className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm text-text-secondary/70">{t('studio.cinema.logoUsageRounds')}</dt>
              <dd className="text-base text-text-primary/85">{sentRounds}</dd>
            </div>
            {usage && allUnmeasured ? (
              <div className="text-sm text-text-secondary/70">{t('studio.tokens.unmeasured')}</div>
            ) : usage ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-text-secondary/70">{t('studio.tokens.input')}</dt>
                  <dd className="text-base text-text-primary/85">{formatStudioTokenCount(usage.promptTokens)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-text-secondary/70">{t('studio.tokens.output')}</dt>
                  <dd className="text-base text-text-primary/85">{formatStudioTokenCount(usage.completionTokens)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-text-secondary/70">{t('studio.tokens.total')}</dt>
                  <dd className="text-base font-medium text-text-primary/85">{formatStudioTokenCount(usage.totalTokens)}</dd>
                </div>
              </>
            ) : (
              <div className="text-sm text-text-secondary/55">{t('studio.cinema.logoUsageNoData')}</div>
            )}
          </dl>

          {usage && !allUnmeasured ? (
            <p className="mt-2 text-sm text-text-secondary/55">
              {partial ? t('studio.cinema.logoUsagePartial') : t('studio.cinema.logoUsageMeasured')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}