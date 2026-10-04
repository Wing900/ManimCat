import { useState } from 'react'
import { ImageLightbox } from '../../components/image-preview/lightbox'
import { useI18n } from '../../i18n'
import type { StudioComposerAttachment } from '../composer/types'

interface StudioComposerAttachmentListProps {
  attachments: StudioComposerAttachment[]
  disabled: boolean
  onRemove: (attachmentId: string) => void
  variant?: 'default' | 'minimal'
}

export function StudioComposerAttachmentList({
  attachments,
  disabled,
  onRemove,
  variant = 'default',
}: StudioComposerAttachmentListProps) {
  const { t } = useI18n()
  const isMinimal = variant === 'minimal'
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  if (attachments.length === 0) {
    return null
  }

  return (
    <>
      <div className={`flex flex-wrap ${isMinimal ? 'gap-3 pb-4' : 'gap-2'}`}>
        {attachments.map((attachment, index) => (
          <div
            key={attachment.id}
            className={`studio-pop-in group relative overflow-hidden text-left ${isMinimal ? '' : 'rounded-lg border border-border/50 bg-bg-secondary/50'}`}
          >
            <button
              type="button"
              onClick={() => {
                setActiveIndex(index)
                setLightboxOpen(true)
              }}
              className={`${isMinimal ? 'block' : 'block'}`}
            >
              <div className={`${isMinimal ? '' : 'flex items-center gap-3 px-2 py-2'}`}>
                {attachment.kind === 'image' ? (
                  <img
                    src={attachment.previewUrl}
                    alt={t('reference.alt', { index: index + 1 })}
                    className={isMinimal
                      ? 'h-12 w-12 object-cover bg-black/[0.03] opacity-80 transition-opacity duration-300 group-hover:opacity-100'
                      : 'h-12 w-12 rounded-md border border-border/40 object-cover'}
                  />
                ) : null}
                {!isMinimal && (
                  <div className="min-w-0">
                    <div className="text-xs text-text-secondary/70">
                      @{attachment.tokenLabel}
                    </div>
                    <div className="max-w-[11rem] truncate text-sm text-text-primary">
                      {attachment.name}
                    </div>
                  </div>
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(attachment.id)
              }}
              disabled={disabled}
              className={isMinimal
                ? 'absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/45 text-[10px] leading-none text-white opacity-0 transition-opacity group-hover:opacity-100'
                : 'absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] leading-none text-bg-primary opacity-0 transition-opacity group-hover:opacity-100'}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <ImageLightbox
        isOpen={lightboxOpen}
        activeImage={attachments[activeIndex]?.previewUrl}
        activeIndex={activeIndex}
        total={attachments.length}
        initialZoom={1}
        appearance="studio"
        onPrev={attachments.length > 1 ? () => {
          setActiveIndex((current) => (current <= 0 ? attachments.length - 1 : current - 1))
        } : undefined}
        onNext={attachments.length > 1 ? () => {
          setActiveIndex((current) => (current >= attachments.length - 1 ? 0 : current + 1))
        } : undefined}
        onClose={() => {
          setLightboxOpen(false)
        }}
      />
    </>
  )
}
