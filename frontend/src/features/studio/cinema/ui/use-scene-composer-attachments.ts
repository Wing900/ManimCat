import type { ClipboardEvent, DragEvent } from 'react'
import {
  addAttachmentTokenToInput,
  appendStudioReferenceImages,
  filterAttachmentsPresentInInput,
  removeAttachmentTokenFromInput,
} from '../../composer/attachments'
import { useStudioComposerAttachments } from '../../composer/use-studio-composer-attachments'
import { extractImageFilesFromDataTransfer } from '../../components/command-panel/image-transfer'

/**
 * Reference images for the cinema composer.
 *
 * The plot studio's composer keeps the same attachments in local state; here they are scoped to the
 * visible draft: the `@token` lives in the draft text, so the images that reach a Run are exactly the
 * ones still mentioned in it (`filterAttachmentsPresentInInput`). Switching Scene therefore cannot
 * carry another Scene's image into a Run, and a resend keeps the images for free.
 */
interface UseSceneComposerAttachmentsOptions {
  draft: string
  disabled: boolean
  onDraftChange: (text: string) => void
}

export function useSceneComposerAttachments({ draft, disabled, onDraftChange }: UseSceneComposerAttachmentsOptions) {
  const attachments = useStudioComposerAttachments()

  const addFiles = async (files: FileList | File[]) => {
    if (disabled) {
      return
    }
    const added = await attachments.addImageFiles(files)
    if (added.length === 0) {
      return
    }
    onDraftChange(added.reduce((text, attachment) => addAttachmentTokenToInput(text, attachment), draft))
  }

  const removeAttachment = (attachmentId: string) => {
    const target = attachments.attachments.find((attachment) => attachment.id === attachmentId)
    attachments.removeAttachment(attachmentId)
    if (target) {
      onDraftChange(removeAttachmentTokenFromInput(draft, target))
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = extractImageFilesFromDataTransfer(event.clipboardData)
    if (files.length === 0) {
      return
    }
    event.preventDefault()
    void addFiles(files)
  }

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    const files = extractImageFilesFromDataTransfer(event.dataTransfer)
    if (files.length === 0) {
      return
    }
    event.preventDefault()
    void addFiles(files)
  }

  /** The text a Run actually receives: the draft plus the reference block of the images it mentions. */
  const buildRunInput = (text: string): string =>
    appendStudioReferenceImages(text, filterAttachmentsPresentInInput(text, attachments.attachments))

  return {
    attachments: attachments.attachments,
    attachmentError: attachments.attachmentError,
    fileInputRef: attachments.fileInputRef,
    addFiles,
    removeAttachment,
    handlePaste,
    handleDrop,
    buildRunInput,
  }
}
