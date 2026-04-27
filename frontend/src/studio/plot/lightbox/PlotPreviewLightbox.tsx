import { ImageLightbox } from '../../../components/image-preview/lightbox'
import { useI18n } from '../../../i18n'
import { uploadReferenceImage } from '../../../lib/api'

interface PlotPreviewLightboxProps {
  isOpen: boolean
  activeImage?: string
  activeIndex: number
  total: number
  editableFilename?: string
  canNavigate: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onSendPreviewToComposer?: (attachment: { url: string; name: string; mimeType?: string }) => void
}

export function PlotPreviewLightbox({
  isOpen,
  activeImage,
  activeIndex,
  total,
  editableFilename,
  canNavigate,
  onPrev,
  onNext,
  onClose,
  onSendPreviewToComposer,
}: PlotPreviewLightboxProps) {
  const { t } = useI18n()

  return (
    <ImageLightbox
      isOpen={isOpen}
      activeImage={activeImage}
      activeIndex={activeIndex}
      total={total}
      initialZoom={0.5}
      baseScaleMode="cover"
      baseScaleBias={1}
      minZoom={0.25}
      maxZoom={4}
      zoomDisplayScale={2}
      editableFilename={editableFilename ?? t('studio.plot.inlinePreview')}
      appearance="studio"
      onPrev={canNavigate ? onPrev : undefined}
      onNext={canNavigate ? onNext : undefined}
      onCommitAnnotatedImage={onSendPreviewToComposer ? async ({ file, filename }) => {
        const uploaded = await uploadReferenceImage(file)
        onSendPreviewToComposer({
          url: uploaded.url,
          name: filename,
          mimeType: uploaded.mimeType,
        })
      } : undefined}
      onClose={onClose}
    />
  )
}
