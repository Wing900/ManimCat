import { useI18n } from '../../i18n'
import { translateEventStatus, translateRunStatus, translateSnapshotStatus, translateWorkStatus } from '../labels'
import type { StudioRender, StudioRun } from '../protocol/studio-agent-types'
import { studioStatusBadge, truncateStudioText } from '../theme'

interface RunStatusProps {
  latestRun: StudioRun | null
  render: StudioRender | null
  latestAssistantText: string
  snapshotStatus: 'idle' | 'loading' | 'ready' | 'error'
  eventStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  errorMessage?: string | null
  onRefresh: () => Promise<void> | void
  onCancel: () => Promise<void> | void
}

export function RunStatus({ latestRun, render, latestAssistantText, snapshotStatus, eventStatus, errorMessage, onRefresh, onCancel }: RunStatusProps) {
  const { t } = useI18n()
  const canCancel = latestRun?.status === 'pending' || latestRun?.status === 'running'

  return (
    <aside className="flex h-full min-h-0 w-[360px] shrink-0 flex-col overflow-hidden px-6 pb-6 pt-8 shadow-[inset_8px_0_12px_-8px_rgba(0,0,0,0.04)] dark:shadow-[inset_8px_0_12px_-8px_rgba(0,0,0,0.2)]">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-text-secondary/45">{t('studio.event.session')}</div>
            <div className="mt-2 text-base font-medium text-text-primary/88">{t('studio.preview')}</div>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => void onRefresh()} className="px-2 py-1 text-[11px] text-text-secondary/50 transition hover:text-text-primary/75">↻</button>
            {canCancel && <button type="button" onClick={() => void onCancel()} className="px-2 py-1 text-[11px] text-rose-600/60 transition hover:text-rose-600">×</button>}
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          <StatusRow label={t('studio.status.run')} value={latestRun ? translateRunStatus(latestRun.status, t) : t('studio.idle')} tone={latestRun?.status ?? 'idle'} />
          <StatusRow label={t('studio.status.render')} value={render ? translateWorkStatus(render.status, t) : t('studio.idle')} tone={render?.status ?? 'idle'} />
          <StatusRow label={t('studio.pipeline.eventStream')} value={translateEventStatus(eventStatus, t)} tone={eventStatus} />
          <StatusRow label={t('studio.pipeline.snapshot')} value={translateSnapshotStatus(snapshotStatus, t)} tone={snapshotStatus} />
        </div>

        {errorMessage && <MessageBlock tone="rose" text={errorMessage} />}
        {latestAssistantText && <MessageBlock tone="sky" text={truncateStudioText(latestAssistantText, 220)} />}
      </div>
    </aside>
  )
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2.5">
        <div className={`h-1.5 w-1.5 rounded-full ${statusDotColor(tone)}`} />
        <div className="text-xs text-text-secondary/50">{label}</div>
      </div>
      <div className={`rounded-full px-2 py-0.5 text-xs ${studioStatusBadge(tone)}`}>{value}</div>
    </div>
  )
}

function MessageBlock({ tone, text }: { tone: 'rose' | 'sky'; text: string }) {
  return <section className={`mt-6 border-l-2 pl-4 ${tone === 'rose' ? 'border-rose-500/40' : 'border-sky-500/40'}`}><div className="text-sm leading-7 text-text-primary/80">{text}</div></section>
}

function statusDotColor(tone: string) {
  switch (tone) {
    case 'running':
    case 'connected':
      return 'bg-emerald-500'
    case 'completed':
    case 'ready':
      return 'bg-sky-500'
    case 'failed':
    case 'disconnected':
    case 'error':
      return 'bg-rose-500'
    case 'queued':
    case 'pending':
    case 'connecting':
    case 'reconnecting':
    case 'loading':
      return 'bg-amber-500'
    default:
      return 'bg-text-secondary/30'
  }
}
