import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { copyImageAssetToClipboard, exportImageAsset } from '../../../components/image-preview/image-asset'
import { useI18n } from '../../../i18n'
import type {
  StudioFileAttachment,
  StudioPermissionDecision,
  StudioPermissionRequest,
  StudioRun,
  StudioSession,
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from '../../protocol/studio-agent-types'
import { truncateStudioText } from '../../theme'
import { PlotPreviewLightbox } from '../lightbox/PlotPreviewLightbox'
import type { PlotPreviewVariant, PlotWorkListItem } from '../types'
import { PlotHistoryStrip } from './PlotHistoryStrip'
import { PlotPreviewContextMenu } from './PlotPreviewContextMenu'
import { PlotPreviewSurface } from './PlotPreviewSurface'

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
  onSendPreviewToComposer?: (attachment: { url: string; name: string; mimeType?: string }) => void
  variant?: PlotPreviewVariant
}

export function PlotPreviewPanel({
  session,
  works,
  selectedWorkId,
  result,
  onSelectWork,
  onReorderWorks,
  onSendPreviewToComposer,
  variant = 'default',
}: PlotPreviewPanelProps) {
  const { t } = useI18n()
  const isTLayout = variant === 't-layout-top'
  const isMinimal = variant === 'pure-minimal-top'
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [draggingWorkId, setDraggingWorkId] = useState<string | null>(null)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [previewMotionKey, setPreviewMotionKey] = useState(0)
  const [previewContextMenu, setPreviewContextMenu] = useState({ open: false, x: 0, y: 0 })
  const [exportingFormat, setExportingFormat] = useState<'png' | 'svg' | 'pdf' | null>(null)
  const [copyingFormat, setCopyingFormat] = useState<'png' | 'svg' | null>(null)

  const stripItems = works.slice(0, 12)
  const historyImages = useMemo(() => {
    return stripItems.flatMap((entry) => (
      getImageAttachments(entry.result?.attachments).map((attachment, imageIndex) => ({
        workId: entry.work.id,
        attachment,
        title: entry.work.title,
        imageIndex,
      }))
    ))
  }, [stripItems])
  const currentWorkImages = useMemo(() => getImageAttachments(result?.attachments), [result?.attachments])
  const currentImagePathsKey = currentWorkImages.map((attachment) => attachment.path).join('|')
  const clampedImageIndex = currentWorkImages.length === 0
    ? 0
    : Math.min(selectedImageIndex, currentWorkImages.length - 1)
  const selectedHistoryIndex = historyImages.findIndex((entry) => (
    entry.workId === selectedWorkId && entry.imageIndex === clampedImageIndex
  ))
  const activeHistoryIndex = selectedHistoryIndex >= 0
    ? selectedHistoryIndex
    : historyImages.findIndex((entry) => entry.workId === selectedWorkId)
  const activeHistoryEntry = historyImages[activeHistoryIndex] ?? null
  const previewAttachment = currentWorkImages[clampedImageIndex] ?? activeHistoryEntry?.attachment ?? null
  const outputPath = formatOutputPath(previewAttachment, session, t('studio.plot.inlinePreview'), t('studio.plot.waitingOutputFile'))

  const handlePreviewExport = useCallback(async (format: 'png' | 'svg' | 'pdf') => {
    if (!previewAttachment?.path || exportingFormat) {
      return
    }

    setPreviewContextMenu({ open: false, x: 0, y: 0 })
    setExportingFormat(format)
    try {
      await exportImageAsset({
        source: previewAttachment.path,
        format,
        index: clampedImageIndex,
        fallbackName: previewAttachment.name,
      })
    } catch (error) {
      console.error(`Failed to export ${format}`, error)
    } finally {
      setExportingFormat(null)
    }
  }, [clampedImageIndex, exportingFormat, previewAttachment])

  const handlePreviewCopy = useCallback(async (format: 'png' | 'svg') => {
    if (!previewAttachment?.path || copyingFormat) {
      return
    }

    setPreviewContextMenu({ open: false, x: 0, y: 0 })
    setCopyingFormat(format)
    try {
      await copyImageAssetToClipboard({
        source: previewAttachment.path,
        format,
      })
    } catch (error) {
      console.error(`Failed to copy ${format}`, error)
    } finally {
      setCopyingFormat(null)
    }
  }, [copyingFormat, previewAttachment])

  useEffect(() => {
    if (!lightboxOpen) {
      setZoom(1)
    }
  }, [lightboxOpen])

  useEffect(() => {
    setSelectedImageIndex(0)
  }, [selectedWorkId, result?.id])

  useEffect(() => {
    setSelectedImageIndex((current) => {
      if (currentWorkImages.length === 0) {
        return current === 0 ? current : 0
      }
      const next = Math.min(current, currentWorkImages.length - 1)
      return next === current ? current : next
    })
  }, [currentImagePathsKey, currentWorkImages.length])

  useEffect(() => {
    if (!previewAttachment?.path) {
      return
    }
    setPreviewMotionKey((current) => current + 1)
  }, [previewAttachment?.path, result?.id])

  const handlePrev = useCallback(() => {
    if (historyImages.length <= 1) {
      return
    }
    const baseIndex = activeHistoryIndex >= 0 ? activeHistoryIndex : 0
    const nextIndex = baseIndex <= 0 ? historyImages.length - 1 : baseIndex - 1
    const nextEntry = historyImages[nextIndex]
    onSelectWork(nextEntry.workId)
    setSelectedImageIndex(nextEntry.imageIndex)
  }, [activeHistoryIndex, historyImages, onSelectWork])

  const handleNext = useCallback(() => {
    if (historyImages.length <= 1) {
      return
    }
    const baseIndex = activeHistoryIndex >= 0 ? activeHistoryIndex : 0
    const nextIndex = baseIndex >= historyImages.length - 1 ? 0 : baseIndex + 1
    const nextEntry = historyImages[nextIndex]
    onSelectWork(nextEntry.workId)
    setSelectedImageIndex(nextEntry.imageIndex)
  }, [activeHistoryIndex, historyImages, onSelectWork])

  useEffect(() => {
    if (lightboxOpen || historyImages.length <= 1) {
      return undefined
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable
      ) {
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handlePrev()
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleNext()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [handleNext, handlePrev, historyImages.length, lightboxOpen])

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

  const handleSurfaceContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!previewAttachment?.path) {
      return
    }
    setPreviewContextMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
    })
  }

  return (
    <section className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${isTLayout || isMinimal ? 'bg-transparent' : 'bg-bg-primary/40 backdrop-blur-sm'}`}>
      {!isTLayout && !isMinimal && (
        <div className="relative shrink-0 px-8 pb-3 pt-8">
          <div className="flex items-center justify-between">
            <div className="group flex items-center gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-accent/40" />
              <div className="min-w-0 font-mono text-[10px] uppercase tracking-[0.2em] text-text-secondary/40 transition-colors group-hover:text-text-secondary/70">
                {outputPath}
              </div>
              <PlotCornerPaw className="h-3.5 w-3.5 text-text-secondary/20 transition-colors duration-500 group-hover:text-text-secondary/32" />
            </div>
          </div>
        </div>
      )}

      <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${isTLayout || isMinimal ? 'p-0' : 'px-6 pb-6 pt-2 sm:px-8 lg:px-10'}`}>
        <div className="relative min-h-0 flex-1">
          <div className={`flex h-full items-center justify-center ${isTLayout || isMinimal ? '' : 'min-h-[360px] sm:min-h-[460px] lg:min-h-[560px]'}`}>
            <PlotPreviewSurface
              key={`${previewMotionKey}:${previewAttachment?.path ?? 'empty'}`}
              attachment={previewAttachment}
              result={result}
              canNavigate={historyImages.length > 1}
              currentIndex={activeHistoryIndex >= 0 ? activeHistoryIndex : 0}
              total={historyImages.length}
              variant={variant}
              onOpen={() => setLightboxOpen(true)}
              onContextMenu={handleSurfaceContextMenu}
              onPrev={handlePrev}
              onNext={handleNext}
            />
          </div>
        </div>

        {!isTLayout && !isMinimal && (
          <PlotHistoryStrip
            entries={historyImages}
            selectedWorkId={selectedWorkId}
            selectedImageIndex={clampedImageIndex}
            draggingWorkId={draggingWorkId}
            onSelect={(workId, imageIndex) => {
              onSelectWork(workId)
              setSelectedImageIndex(imageIndex)
            }}
            onDragStart={setDraggingWorkId}
            onDrop={(workId) => {
              moveWork(workId)
              setDraggingWorkId(null)
            }}
            onDragEnd={() => setDraggingWorkId(null)}
          />
        )}
      </div>

      <PlotPreviewLightbox
        isOpen={lightboxOpen}
        activeImage={previewAttachment?.path}
        activeIndex={activeHistoryIndex >= 0 ? activeHistoryIndex : 0}
        total={historyImages.length}
        zoom={zoom}
        editableFilename={previewAttachment?.name}
        canNavigate={historyImages.length > 1}
        onZoomChange={setZoom}
        onPrev={handlePrev}
        onNext={handleNext}
        onSendPreviewToComposer={onSendPreviewToComposer}
        onClose={() => {
          setLightboxOpen(false)
          setZoom(1)
        }}
      />
      <PlotPreviewContextMenu
        isOpen={previewContextMenu.open}
        x={previewContextMenu.x}
        y={previewContextMenu.y}
        hasPreview={Boolean(previewAttachment?.path)}
        copyingFormat={copyingFormat}
        exportingFormat={exportingFormat}
        onCopy={(format) => {
          void handlePreviewCopy(format)
        }}
        onExport={(format) => {
          void handlePreviewExport(format)
        }}
        onOpenLightbox={() => {
          setPreviewContextMenu({ open: false, x: 0, y: 0 })
          setLightboxOpen(true)
        }}
        onClose={() => setPreviewContextMenu({ open: false, x: 0, y: 0 })}
      />
    </section>
  )
}

function getImageAttachments(attachments: StudioFileAttachment[] | undefined): StudioFileAttachment[] {
  return (attachments ?? []).filter(isImageAttachment)
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

function PlotCornerPaw({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={`studio-paw-float ${className}`.trim()}>
      <g fill="currentColor">
        <ellipse cx="20" cy="18" rx="6" ry="8" transform="rotate(-18 20 18)" />
        <ellipse cx="32" cy="13" rx="6" ry="8" />
        <ellipse cx="44" cy="18" rx="6" ry="8" transform="rotate(18 44 18)" />
        <ellipse cx="18" cy="31" rx="5" ry="7" transform="rotate(-30 18 31)" />
        <path d="M32 28c-10 0-18 7-18 16 0 7 6 11 11 11 3 0 5-1 7-3 2 2 4 3 7 3 5 0 11-4 11-11 0-9-8-16-18-16Z" />
      </g>
    </svg>
  )
}
