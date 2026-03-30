import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ImageLightbox } from '../../components/image-preview/lightbox'
import { CLOSED_IMAGE_CONTEXT_MENU, ImageContextMenu } from '../../components/image-preview/context-menu'
import { copyImageAssetToClipboard, exportImageAsset } from '../../components/image-preview/image-asset'
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
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [previewMotionKey, setPreviewMotionKey] = useState(0)
  const [previewContextMenu, setPreviewContextMenu] = useState(CLOSED_IMAGE_CONTEXT_MENU)
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

    setPreviewContextMenu(CLOSED_IMAGE_CONTEXT_MENU)
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

    setPreviewContextMenu(CLOSED_IMAGE_CONTEXT_MENU)
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

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg-primary/40 backdrop-blur-sm">
      <div className="relative shrink-0 px-8 pb-3 pt-8">
        <div className="flex items-center justify-between">
          <div className="group flex items-center gap-3">
            <div className="h-1.5 w-1.5 rounded-full bg-accent-rgb/40" />
            <div className="min-w-0 font-mono text-[10px] uppercase tracking-[0.2em] text-text-secondary/40 transition-colors group-hover:text-text-secondary/70">
              {outputPath}
            </div>
            <PlotCornerPaw className="h-3.5 w-3.5 text-text-secondary/20 transition-colors duration-500 group-hover:text-text-secondary/32" />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-6 pb-6 pt-2 sm:px-8 lg:px-10">
        <div className="relative min-h-0 flex-1">
          <div className="flex h-full min-h-[360px] items-center justify-center sm:min-h-[460px] lg:min-h-[560px]">
            <PlotPreviewSurface
              key={`${previewMotionKey}:${previewAttachment?.path ?? 'empty'}`}
              attachment={previewAttachment}
              result={result}
              canNavigate={historyImages.length > 1}
              currentIndex={activeHistoryIndex >= 0 ? activeHistoryIndex : 0}
              total={historyImages.length}
              onOpen={() => setLightboxOpen(true)}
              onContextMenu={(event) => {
                event.preventDefault()
                if (!previewAttachment?.path) {
                  return
                }
                setPreviewContextMenu({
                  open: true,
                  x: event.clientX,
                  y: event.clientY,
                })
              }}
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
                {historyImages.length.toString().padStart(2, '0')}
              </span>
            </div>
          </div>

          <div className="mt-4 flex min-w-0 gap-4 overflow-x-auto pb-4 pt-1">
            {historyImages.map((entry, index) => {
              const selected = entry.workId === selectedWorkId && entry.imageIndex === clampedImageIndex
              return (
                <button
                  key={`${entry.workId}-${entry.imageIndex}-${entry.attachment.path}`}
                  type="button"
                  draggable
                  onClick={() => {
                    onSelectWork(entry.workId)
                    setSelectedImageIndex(entry.imageIndex)
                  }}
                  onDragStart={() => setDraggingWorkId(entry.workId)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    moveWork(entry.workId)
                    setDraggingWorkId(null)
                  }}
                  onDragEnd={() => setDraggingWorkId(null)}
                  className={`group relative flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-all duration-500 ${
                    selected
                      ? 'scale-[0.96] border border-accent-rgb/25 bg-bg-secondary/60 shadow-inner'
                      : 'border border-transparent bg-bg-secondary/30 hover:scale-[0.98] hover:bg-bg-secondary/50'
                  } ${draggingWorkId === entry.workId ? 'opacity-50' : ''}`}
                >
                  <img
                    src={entry.attachment.path}
                    alt={entry.attachment.name ?? entry.title}
                    className={`h-full w-full object-cover transition-transform duration-700 ${selected ? 'scale-100' : 'scale-110 opacity-60 group-hover:scale-100 group-hover:opacity-100'}`}
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-2 py-1 text-left">
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/80">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                  </div>
                  {selected && <div className="pointer-events-none absolute inset-0 bg-accent-rgb/5" />}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <ImageLightbox
        isOpen={lightboxOpen}
        activeImage={previewAttachment?.path}
        activeIndex={activeHistoryIndex >= 0 ? activeHistoryIndex : 0}
        total={historyImages.length}
        zoom={zoom}
        variant="studio-light"
        onZoomChange={setZoom}
        onPrev={historyImages.length > 1 ? handlePrev : undefined}
        onNext={historyImages.length > 1 ? handleNext : undefined}
        onClose={() => {
          setLightboxOpen(false)
          setZoom(1)
        }}
      />
      <ImageContextMenu
        state={previewContextMenu}
        variant="studio-light"
        items={previewAttachment?.path ? [
          {
            key: 'copy-png',
            label: copyingFormat === 'png' ? t('image.copying') : t('image.copyPng'),
            busy: copyingFormat === 'png',
            onClick: () => {
              void handlePreviewCopy('png')
            },
          },
          {
            key: 'copy-svg',
            label: copyingFormat === 'svg' ? t('image.copying') : t('image.copySvg'),
            busy: copyingFormat === 'svg',
            onClick: () => {
              void handlePreviewCopy('svg')
            },
          },
          {
            key: 'export-png',
            label: exportingFormat === 'png' ? t('image.exporting') : t('image.exportPng'),
            onClick: () => {
              void handlePreviewExport('png')
            },
            busy: exportingFormat === 'png',
          },
          {
            key: 'export-svg',
            label: exportingFormat === 'svg' ? t('image.exporting') : t('image.exportSvg'),
            onClick: () => {
              void handlePreviewExport('svg')
            },
            busy: exportingFormat === 'svg',
          },
          {
            key: 'export-pdf',
            label: exportingFormat === 'pdf' ? t('image.exporting') : t('image.exportPdf'),
            onClick: () => {
              void handlePreviewExport('pdf')
            },
            busy: exportingFormat === 'pdf',
          },
          {
            key: 'open-lightbox',
            label: t('image.openLightbox'),
            onClick: () => {
              setPreviewContextMenu(CLOSED_IMAGE_CONTEXT_MENU)
              setLightboxOpen(true)
            },
          },
        ] : []}
        onClose={() => setPreviewContextMenu(CLOSED_IMAGE_CONTEXT_MENU)}
      />
    </section>
  )
}

function PlotPreviewSurface(input: {
  attachment: StudioFileAttachment | null | undefined
  result: StudioWorkResult | null
  canNavigate: boolean
  currentIndex: number
  total: number
  onOpen: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onPrev: () => void
  onNext: () => void
}) {
  const { t } = useI18n()
  if (input.attachment?.mimeType?.startsWith('image/') || isImagePath(input.attachment?.path)) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-visible">
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
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/30 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-white/85 backdrop-blur-sm">
              {String(input.currentIndex + 1).padStart(2, '0')} / {String(input.total).padStart(2, '0')}
            </div>
          </>
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
            if (event.button !== 0) {
              return
            }
            input.onOpen()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              input.onOpen()
            }
          }}
          onContextMenu={input.onContextMenu}
          className="flex h-full w-full cursor-zoom-in items-center justify-center animate-fade-in-soft"
          title={t('image.openTitle')}
        >
          <img
            src={input.attachment?.path}
            alt={input.attachment?.name ?? t('studio.plot.previewAlt')}
            className="max-h-full max-w-full object-contain"
          />
        </div>
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

function getAbsoluteUrl(path: string): string {
  if (/^(data:|https?:\/\/)/i.test(path)) {
    return path
  }

  return new URL(path, window.location.origin).toString()
}

function isPreviewAttachment(attachment: { path: string; mimeType?: string } | undefined) {
  return isImageAttachment(attachment)
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
