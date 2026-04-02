import { CLOSED_IMAGE_CONTEXT_MENU, ImageContextMenu } from '../../../components/image-preview/context-menu'
import { useI18n } from '../../../i18n'

interface PlotPreviewContextMenuProps {
  isOpen: boolean
  x: number
  y: number
  hasPreview: boolean
  copyingFormat: 'png' | 'svg' | null
  exportingFormat: 'png' | 'svg' | 'pdf' | null
  onCopy: (format: 'png' | 'svg') => void
  onExport: (format: 'png' | 'svg' | 'pdf') => void
  onOpenLightbox: () => void
  onClose: () => void
}

export function PlotPreviewContextMenu({
  isOpen,
  x,
  y,
  hasPreview,
  copyingFormat,
  exportingFormat,
  onCopy,
  onExport,
  onOpenLightbox,
  onClose,
}: PlotPreviewContextMenuProps) {
  const { t } = useI18n()

  return (
    <ImageContextMenu
      state={isOpen ? { open: true, x, y } : CLOSED_IMAGE_CONTEXT_MENU}
      variant="studio-light"
      items={hasPreview ? [
        {
          key: 'copy-png',
          label: copyingFormat === 'png' ? t('image.copying') : t('image.copyPng'),
          busy: copyingFormat === 'png',
          onClick: () => onCopy('png'),
        },
        {
          key: 'copy-svg',
          label: copyingFormat === 'svg' ? t('image.copying') : t('image.copySvg'),
          busy: copyingFormat === 'svg',
          onClick: () => onCopy('svg'),
        },
        {
          key: 'export-png',
          label: exportingFormat === 'png' ? t('image.exporting') : t('image.exportPng'),
          busy: exportingFormat === 'png',
          onClick: () => onExport('png'),
        },
        {
          key: 'export-svg',
          label: exportingFormat === 'svg' ? t('image.exporting') : t('image.exportSvg'),
          busy: exportingFormat === 'svg',
          onClick: () => onExport('svg'),
        },
        {
          key: 'export-pdf',
          label: exportingFormat === 'pdf' ? t('image.exporting') : t('image.exportPdf'),
          busy: exportingFormat === 'pdf',
          onClick: () => onExport('pdf'),
        },
        {
          key: 'open-lightbox',
          label: t('image.openLightbox'),
          onClick: onOpenLightbox,
        },
      ] : []}
      onClose={onClose}
    />
  )
}
