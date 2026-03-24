import { useEffect, useMemo, useState } from 'react'
import { ImageLightbox } from '../../components/image-preview/lightbox'
import { useI18n } from '../../i18n'
import type {
  StudioFileAttachment,
  StudioPermissionDecision,
  StudioPermissionRequest,
  StudioRun,
  StudioSession,
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from '../protocol/studio-agent-types'
import { truncateStudioText } from '../theme'

interface PlotWorkListItem {
  work: StudioWork
  latestTask: StudioTask | null
  result: StudioWorkResult | null
}

interface PlotPreviewPanelProps {
  session: StudioSession | null
  works: PlotWorkListItem[]
  selectedWorkId: string | null
  work: StudioWork | null
  result: StudioWorkResult | null
  latestRun: StudioRun | null
  tasks: StudioTask[]
  requests: StudioPermissionRequest[]
  replyingPermissionIds: Record<string, boolean>
  latestAssistantText: string
  errorMessage?: string | null
  onSelectWork: (workId: string) => void
  onReorderWorks: (workIds: string[]) => void
  onReply: (requestId: string, reply: StudioPermissionDecision) => Promise<void> | void
}

export function PlotPreviewPanel({
  session,
  works,
  selectedWorkId,
  result,
  onSelectWork,
  onReorderWorks,
}: PlotPreviewPanelProps) {
  const { t } = useI18n()
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [draggingWorkId, setDraggingWorkId] = useState<string | null>(null)

  const stripItems = works.slice(0, 12)
  const images = useMemo(() => {
    return stripItems
      .map((entry) => ({
        workId: entry.work.id,
        attachment: entry.result?.attachments?.find(isImageAttachment) ?? null,
        title: entry.work.title,
      }))
      .filter((entry): entry is { workId: string; attachment: StudioFileAttachment; title: string } => Boolean(entry.attachment))
  }, [stripItems])

  const activeImageIndex = Math.max(0, images.findIndex((entry) => entry.workId === selectedWorkId))
  const activeImage = images[activeImageIndex] ?? null
  const previewAttachment = result?.attachments?.find(isPreviewAttachment) ?? result?.attachments?.[0] ?? activeImage?.attachment ?? null
  const outputPath = formatOutputPath(previewAttachment, session, t('studio.plot.inlinePreview'), t('studio.plot.waitingOutputFile'))

  useEffect(() => {
    if (!lightboxOpen) {
      setZoom(1)
    }
  }, [lightboxOpen])

  const handlePrev = () => {
    if (images.length <= 1) {
      return
    }
    const nextIndex = activeImageIndex <= 0 ? images.length - 1 : activeImageIndex - 1
    onSelectWork(images[nextIndex].workId)
  }

  const handleNext = () => {
    if (images.length <= 1) {
      return
    }
    const nextIndex = activeImageIndex >= images.length - 1 ? 0 : activeImageIndex + 1
    onSelectWork(images[nextIndex].workId)
  }

  const moveWork = (targetWorkId: string) => {
    if (!draggingWorkId || draggingWorkId === targetWorkId) {
      return
    }

    const nextIds = stripItems.map((entry) => entry.work.id)
    const fromIndex = nextIds.indexOf(draggingWorkId)
    const toIndex = nextIds.indexOf(targetWorkId)
    if (fromIndex === -1 || toIndex === -1) {
      return
    }

    const reordered = [...nextIds]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    onReorderWorks(reordered)
  }

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg-primary/40 backdrop-blur-sm">
      <div className="relative shrink-0 px-8 pb-3 pt-8">
        <div className="flex items-center justify-between">
          <div className="group flex items-center gap-3">
            <div className="h-1.5 w-1.5 rounded-full bg-accent-rgb/40" />
            <div className="min-w-0 font-mono text-[10px] uppercase tracking-[0.2em] text-text-secondary/40 transition-colors group-hover:text-text-secondary/70">
              {outputPath}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2 sm:px-8 lg:px-10">
        <div className="relative min-h-0 flex-1">
          <div className="flex h-full min-h-[360px] items-center justify-center sm:min-h-[460px] lg:min-h-[560px]">
            <PlotPreviewSurface
              attachment={previewAttachment}
              result={result}
              canNavigate={images.length > 1}
              onOpen={() => setLightboxOpen(true)}
              onPrev={handlePrev}
              onNext={handleNext}
            />
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.4em] text-text-secondary/35">{t('studio.plot.history')}</div>
              <div className="h-px w-8 bg-border/10" />
              <span className="font-mono text-[10px] text-text-secondary/40">
                {works.length.toString().padStart(2, '0')}
              </span>
            </div>
          </div>

          <div className="mt-4 flex gap-4 overflow-x-auto pb-4 pt-1">
            {stripItems.map((entry, index) => {
              const selected = entry.work.id === selectedWorkId
              const thumbnail = entry.result?.attachments?.find(isImageAttachment) ?? null
              return (
                <button
                  key={entry.work.id}
                  type="button"
                  draggable
                  onClick={() => onSelectWork(entry.work.id)}
                  onDragStart={() => setDraggingWorkId(entry.work.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    moveWork(entry.work.id)
                    setDraggingWorkId(null)
                  }}
                  onDragEnd={() => setDraggingWorkId(null)}
                  className={`group relative flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-all duration-500 ${
                    selected
                      ? 'scale-[0.96] border border-accent-rgb/25 bg-bg-secondary/60 shadow-inner'
                      : 'border border-transparent bg-bg-secondary/30 hover:scale-[0.98] hover:bg-bg-secondary/50'
                  } ${draggingWorkId === entry.work.id ? 'opacity-50' : ''}`}
                >
                  {thumbnail ? (
                    <img
                      src={thumbnail.path}
                      alt={thumbnail.name ?? entry.work.title}
                      className={`h-full w-full object-cover transition-transform duration-700 ${selected ? 'scale-100' : 'scale-110 opacity-60 group-hover:scale-100 group-hover:opacity-100'}`}
                    />
                  ) : (
                    <div className="font-mono text-[9px] tracking-tighter text-text-secondary/40">
                      PLOT_{String(index + 1).padStart(2, '0')}
                    </div>
                  )}
                  {selected && <div className="pointer-events-none absolute inset-0 bg-accent-rgb/5" />}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <ImageLightbox
        isOpen={lightboxOpen}
        activeImage={activeImage?.attachment.path}
        activeIndex={activeImageIndex}
        total={images.length}
        zoom={zoom}
        onZoomOut={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}
        onZoomIn={() => setZoom((value) => Math.min(4, Math.round((value + 0.1) * 10) / 10))}
        onPrev={images.length > 1 ? handlePrev : undefined}
        onNext={images.length > 1 ? handleNext : undefined}
        onClose={() => {
          setLightboxOpen(false)
          setZoom(1)
        }}
      />
    </section>
  )
}

function PlotPreviewSurface(input: {
  attachment: StudioFileAttachment | null | undefined
  result: StudioWorkResult | null
  canNavigate: boolean
  onOpen: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const { t } = useI18n()
  if (input.attachment?.mimeType?.startsWith('image/') || isImagePath(input.attachment?.path)) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[20px] bg-bg-secondary/30 shadow-[0_28px_60px_rgba(15,23,42,0.08)]">
        {input.canNavigate && (
          <>
            <button
              type="button"
              onClick={input.onPrev}
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-sm text-text-secondary/70 transition hover:text-text-primary"
            >
              ←
            </button>
            <button
              type="button"
              onClick={input.onNext}
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 text-sm text-text-secondary/70 transition hover:text-text-primary"
            >
              →
            </button>
          </>
        )}
        <button
          type="button"
          onClick={input.onOpen}
          className="flex h-full w-full cursor-zoom-in items-center justify-center"
          title={t('image.openTitle')}
        >
          <img
            src={input.attachment?.path}
            alt={input.attachment?.name ?? t('studio.plot.previewAlt')}
            className="max-h-full max-w-full object-contain"
          />
        </button>
      </div>
    )
  }

  if (input.result?.kind === 'failure-report') {
    return (
      <div className="flex flex-col items-center justify-center opacity-30">
        <div className="text-sm font-medium uppercase tracking-widest text-rose-600/70">{t('studio.renderFailed')}</div>
      </div>
    )
  }

  return null
}

function isPreviewAttachment(attachment: { path: string; mimeType?: string } | undefined) {
  return isImageAttachment(attachment)
}

function formatOutputPath(
  attachment: StudioFileAttachment | null | undefined,
  session: StudioSession | null,
  inlinePreviewLabel: string,
  waitingOutputLabel: string,
) {
  if (attachment?.name) {
    return attachment.name
  }

  if (attachment?.path) {
    if (attachment.path.startsWith('data:')) {
      return inlinePreviewLabel
    }
    return truncateStudioText(attachment.path, 88)
  }

  return session?.directory ?? waitingOutputLabel
}

function isImageAttachment(attachment: { path: string; mimeType?: string } | undefined) {
  if (!attachment) {
    return false
  }

  return attachment.mimeType?.startsWith('image/') || isImagePath(attachment.path)
}

function isImagePath(path?: string) {
  return Boolean(path && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path))
}
