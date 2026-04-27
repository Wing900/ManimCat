import { useState } from 'react'
import { copyImageAssetToClipboard, exportImageAsset, type ExportFormat } from '../image-asset'
import { CLOSED_IMAGE_CONTEXT_MENU, type ImageContextMenuState } from '../context-menu-state'

export function useLightboxExport(activeImage?: string, activeIndex = 0) {
  const [contextMenu, setContextMenu] = useState(CLOSED_IMAGE_CONTEXT_MENU)
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null)
  const [copyingFormat, setCopyingFormat] = useState<'png' | 'svg' | null>(null)

  const closeContextMenu = () => setContextMenu(CLOSED_IMAGE_CONTEXT_MENU)

  const openContextMenu = (x: number, y: number) => {
    setContextMenu({ open: true, x, y })
  }

  const handleExport = async (format: ExportFormat) => {
    if (!activeImage || exportingFormat) {
      return;
    }

    closeContextMenu();
    setExportingFormat(format);
    try {
      await exportImageAsset({
        source: activeImage,
        format,
        index: activeIndex,
      });
    } catch (error) {
      console.error(`Failed to export ${format}`, error);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleCopy = async (format: 'png' | 'svg') => {
    if (!activeImage || copyingFormat) {
      return;
    }

    closeContextMenu();
    setCopyingFormat(format);
    try {
      await copyImageAssetToClipboard({
        source: activeImage,
        format,
      });
    } catch (error) {
      console.error(`Failed to copy ${format}`, error);
    } finally {
      setCopyingFormat(null);
    }
  };

  const reset = () => {
    setContextMenu(CLOSED_IMAGE_CONTEXT_MENU);
    setExportingFormat(null);
    setCopyingFormat(null);
  }

  return {
    contextMenu,
    exportingFormat,
    copyingFormat,
    closeContextMenu,
    openContextMenu,
    handleExport,
    handleCopy,
    reset,
  }
}
