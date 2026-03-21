import type { StudioRun } from '../protocol/studio-agent-types'
import { formatStudioTime, studioPanelClass, studioStatusBadge, truncateStudioText } from '../theme'

interface StudioEventStatusBarProps {
  sessionTitle?: string
  snapshotStatus: string
  eventStatus: string
  lastEventType?: string | null
  lastEventAt?: number | null
  eventError?: string | null
  latestRun?: StudioRun | null
  latestAssistantText?: string
  latestQuestion?: {
    question: string
    details?: string
  } | null
}

export function StudioEventStatusBar({
  sessionTitle,
  snapshotStatus,
  eventStatus,
  lastEventType,
  lastEventAt,
  eventError,
  latestRun,
  latestAssistantText,
  latestQuestion,
}: StudioEventStatusBarProps) {
  return (
    <section className={studioPanelClass('p-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-[0.28em] text-text-secondary">Studio Session</span>
        <span className="text-sm font-medium text-text-primary">{sessionTitle ?? 'Initializing'}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioStatusBadge(snapshotStatus)}`}>
          snapshot {snapshotStatus}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioStatusBadge(eventStatus)}`}>
          events {eventStatus}
        </span>
        {latestRun && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioStatusBadge(latestRun.status)}`}>
            run {latestRun.status}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 text-sm text-text-secondary md:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em]">Latest Event</div>
          <div className="mt-1 text-text-primary">{lastEventType ?? 'Waiting for stream'}</div>
          <div className="mt-1 text-xs">{formatStudioTime(lastEventAt)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.2em]">Assistant Stream</div>
          <div className="mt-1 text-text-primary">{latestAssistantText ? truncateStudioText(latestAssistantText) : 'No live text yet'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.2em]">Pending Question</div>
          <div className="mt-1 text-text-primary">{latestQuestion?.question ?? 'None'}</div>
          {latestQuestion?.details && <div className="mt-1 text-xs">{truncateStudioText(latestQuestion.details, 90)}</div>}
        </div>
      </div>

      {eventError && <div className="mt-3 text-sm text-rose-600 dark:text-rose-300">{eventError}</div>}
    </section>
  )
}
