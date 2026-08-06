import { useI18n } from '../../i18n'
import type { StudioFileAttachment, StudioRender, StudioRun, StudioSession } from '../protocol/studio-agent-types'
import { translateRunStatus, translateWorkStatus } from '../labels'
import { formatStudioTime, studioStatusBadge } from '../theme'
import { RenderHistory } from './RenderHistory'

interface StudioPreviewProps {
  session: StudioSession | null
  renders: StudioRender[]
  selectedRenderId: string | null
  render: StudioRender | null
  latestRun: StudioRun | null
  onSelectRender: (renderId: string) => void
}

export function StudioPreview({ session, renders, selectedRenderId, render, latestRun, onSelectRender }: StudioPreviewProps) {
  const { t } = useI18n()
  const previewAttachment = render?.attachments?.find(isPreviewAttachment) ?? render?.attachments?.[0] ?? null

  return (
    <aside className="flex h-full min-h-0 w-[360px] shrink-0 flex-col gap-6 overflow-hidden px-6 pb-6 pt-8 shadow-[inset_-8px_0_12px_-8px_rgba(0,0,0,0.04)] dark:shadow-[inset_-8px_0_12px_-8px_rgba(0,0,0,0.2)]">
      <div className="shrink-0">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.34em] text-text-secondary/45">{t('studio.preview')}</div>
          <span className="studio-paw-float text-sm opacity-30">🐾</span>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-medium text-text-primary/90">{render?.title ?? t('studio.waitingOutput')}</h2>
            <div className="mt-2 truncate text-xs leading-6 text-text-secondary/60">
              {session?.title ?? t('studio.sessionLabel')} · {latestRun ? translateRunStatus(latestRun.status, t) : t('studio.idle')}
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioStatusBadge(render?.status ?? latestRun?.status ?? 'idle')}`}>
            {render ? translateWorkStatus(render.status, t) : latestRun ? translateRunStatus(latestRun.status, t) : t('studio.idle')}
          </span>
        </div>
      </div>

      <section className="shrink-0 overflow-hidden">
        <div className="aspect-video rounded-2xl bg-bg-secondary/15">
          <PreviewSurface attachment={previewAttachment} render={render} />
        </div>
        {render && (
          <div className="px-1 py-4">
            <div className="text-[13px] leading-6 text-text-primary/70">{render.concept}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-text-secondary/40">
              <span>{render.kind}</span>
              <span>·</span>
              <span>{formatStudioTime(render.updatedAt)}</span>
            </div>
            {render.error && <div className="mt-2 text-xs leading-5 text-rose-600/75">{render.error}</div>}
          </div>
        )}
      </section>

      <RenderHistory renders={renders} selectedRenderId={selectedRenderId} onSelectRender={onSelectRender} />
    </aside>
  )
}

function PreviewSurface({ attachment, render }: { attachment: StudioFileAttachment | null | undefined; render: StudioRender | null }) {
  const { t } = useI18n()
  if (attachment?.mimeType?.startsWith('video/') || isVideoPath(attachment?.path)) {
    return <video src={attachment.path} controls className="h-full w-full rounded-2xl object-contain" />
  }

  if (attachment?.mimeType?.startsWith('image/') || isImagePath(attachment?.path)) {
    return <img src={attachment.path} alt={attachment.name ?? t('common.preview')} className="h-full w-full rounded-2xl object-contain" />
  }

  if (render?.status === 'failed') {
    return <div className="flex h-full items-center justify-center text-[10px] font-bold uppercase tracking-[0.4em] text-rose-500/70">{t('studio.renderFailed')}</div>
  }

  if (render?.status === 'queued' || render?.status === 'running') {
    return <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.3em] text-text-secondary/40">{translateRenderStatus(render.status, t)}</div>
  }

  return null
}

function translateRenderStatus(status: StudioRender['status'], t: ReturnType<typeof useI18n>['t']) {
  return translateWorkStatus(status, t)
}

function isPreviewAttachment(attachment: StudioFileAttachment) {
  return Boolean(
    attachment.mimeType?.startsWith('video/')
    || attachment.mimeType?.startsWith('image/')
    || isVideoPath(attachment.path)
    || isImagePath(attachment.path),
  )
}

function isVideoPath(path?: string) {
  return Boolean(path && /\.(mp4|webm|mov|m4v)$/i.test(path))
}

function isImagePath(path?: string) {
  return Boolean(path && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path))
}
