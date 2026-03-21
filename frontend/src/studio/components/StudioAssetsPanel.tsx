import type { StudioFileAttachment, StudioRun, StudioSession, StudioTask, StudioWork, StudioWorkResult } from '../protocol/studio-agent-types'
import { formatStudioTime, studioStatusBadge, truncateStudioText } from '../theme'

interface StudioWorkListItem {
  work: StudioWork
  latestTask: StudioTask | null
  result: StudioWorkResult | null
}

interface StudioAssetsPanelProps {
  session: StudioSession | null
  works: StudioWorkListItem[]
  selectedWorkId: string | null
  work: StudioWork | null
  result: StudioWorkResult | null
  latestRun: StudioRun | null
  onSelectWork: (workId: string) => void
}

export function StudioAssetsPanel({
  session,
  works,
  selectedWorkId,
  work,
  result,
  latestRun,
  onSelectWork,
}: StudioAssetsPanelProps) {
  const previewAttachment = result?.attachments?.find(isPreviewAttachment) ?? result?.attachments?.[0] ?? null

  return (
    <aside className="flex w-[360px] shrink-0 flex-col gap-6 px-6 pb-6 pt-8 shadow-[inset_-8px_0_12px_-8px_rgba(0,0,0,0.04)] dark:shadow-[inset_-8px_0_12px_-8px_rgba(0,0,0,0.2)]">
      <div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.34em] text-text-secondary/45">预览区</div>
          <span className="studio-paw-float text-sm opacity-30">🐾</span>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-text-primary/90">{work?.title ?? '等待产出'}</h2>
            <div className="mt-2 text-xs leading-6 text-text-secondary/60">
              {session?.title ?? 'Studio 会话'} · {latestRun ? translateRunStatus(latestRun.status) : '待命'}
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioStatusBadge(work?.status ?? latestRun?.status ?? 'idle')}`}>
            {work ? translateWorkStatus(work.status) : latestRun ? translateRunStatus(latestRun.status) : '待命'}
          </span>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border/10 bg-bg-secondary/30">
        <div className="aspect-video bg-black/[0.04]">
          <PreviewSurface attachment={previewAttachment} result={result} />
        </div>
        <div className="border-t border-border/10 px-5 py-4">
          <div className="text-sm leading-6 text-text-primary/82">{result?.summary ?? '当前 work 还没有可预览的结果。'}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-secondary/55">
            <span>{result ? translateResultKind(result.kind) : '未产出'}</span>
            <span>·</span>
            <span>{result ? formatStudioTime(result.createdAt) : '等待中'}</span>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-text-secondary/45">作品列表</div>
            <div className="mt-1 text-sm text-text-secondary/65">切换要预览的 work</div>
          </div>
          <div className="rounded-full bg-bg-secondary/50 px-3 py-1 text-xs text-text-secondary/65">{works.length}</div>
        </div>

        <div className="mt-4 space-y-1.5">
          {works.map((entry) => {
            const { work: item, latestTask, result: itemResult } = entry
            const selected = item.id === selectedWorkId
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectWork(item.id)}
                className={`w-full rounded-xl px-4 py-3 text-left transition ${
                  selected
                    ? 'border-l-2 border-l-accent-rgb/60 bg-bg-secondary/30'
                    : 'border-l-2 border-l-transparent hover:bg-bg-secondary/20'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary/84">{item.title}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-text-secondary/45">{translateWorkType(item.type)}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${studioStatusBadge(item.status)}`}>
                    {translateWorkStatus(item.status)}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-[11px] leading-5 text-text-secondary/58">
                  <div>{latestTask ? `Task: ${truncateStudioText(latestTask.title, 42)}` : 'Task: waiting'}</div>
                  <div className="text-text-primary/64">{itemResult ? truncateStudioText(itemResult.summary, 54) : 'Result: pending'}</div>
                </div>
              </button>
            )
          })}

          {works.length === 0 && <div className="text-sm text-text-secondary/55">先在中间发出指令，左侧就会出现可预览的 work。</div>}
        </div>
      </section>
    </aside>
  )
}

function PreviewSurface({
  attachment,
  result,
}: {
  attachment: StudioFileAttachment | null | undefined
  result: StudioWorkResult | null
}) {
  if (attachment?.mimeType?.startsWith('video/') || isVideoPath(attachment?.path)) {
    return <video src={attachment?.path} controls className="h-full w-full object-cover" />
  }

  if (attachment?.mimeType?.startsWith('image/') || isImagePath(attachment?.path)) {
    return <img src={attachment?.path} alt={attachment?.name ?? 'preview'} className="h-full w-full object-cover" />
  }

  if (result?.kind === 'failure-report') {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm leading-7 text-rose-500/75">
        当前 work 以失败报告结束。右侧会显示任务与失败摘要。
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-sm leading-7 text-text-secondary/55">
      暂无可视化预览。渲染产物、图片或视频出现后会优先显示在这里。
    </div>
  )
}

function isPreviewAttachment(attachment: { path: string; mimeType?: string } | undefined) {
  if (!attachment) {
    return false
  }

  return (
    attachment.mimeType?.startsWith('video/') ||
    attachment.mimeType?.startsWith('image/') ||
    isVideoPath(attachment.path) ||
    isImagePath(attachment.path)
  )
}

function isVideoPath(path?: string) {
  return Boolean(path && /\.(mp4|webm|mov|m4v)$/i.test(path))
}

function isImagePath(path?: string) {
  return Boolean(path && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path))
}

function translateRunStatus(status: string) {
  switch (status) {
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    case 'pending':
      return '排队中'
    default:
      return status
  }
}

function translateWorkStatus(status: string) {
  switch (status) {
    case 'running':
      return '进行中'
    case 'completed':
      return '完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '取消'
    case 'proposed':
      return '提议'
    default:
      return status
  }
}

function translateWorkType(type: string) {
  switch (type) {
    case 'video':
      return '视频'
    case 'review':
      return '审查'
    case 'design':
      return '设计'
    case 'edit':
      return '编辑'
    case 'render-fix':
      return '渲染修复'
    default:
      return type
  }
}

function translateResultKind(kind: string) {
  switch (kind) {
    case 'render-output':
      return '渲染产物'
    case 'review-report':
      return '审查报告'
    case 'design-plan':
      return '设计方案'
    case 'edit-result':
      return '编辑结果'
    case 'failure-report':
      return '失败报告'
    default:
      return kind
  }
}
