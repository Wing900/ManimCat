import { useCallback, useRef, useState } from 'react'
import { useI18n } from '../../../shared/i18n/index'
import { uploadReferenceImage } from '../../../infrastructure/api/api'
import type { ReferenceImage } from '../../../shared/types/api'
import { MAX_IMAGE_SIZE } from '../../workflow/input-form/constants'
import { debugStudioMessages } from '../agent-response/debug'
import { createComposerImageAttachment, extractNameFromUrl } from './attachments'
import type { StudioComposerAttachment } from './types'

interface UseStudioComposerAttachmentsResult {
  attachments: StudioComposerAttachment[]
  attachmentError: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  addImageFiles: (files: FileList | File[]) => Promise<StudioComposerAttachment[]>
  appendReferenceImages: (images: ReferenceImage[]) => StudioComposerAttachment[]
  appendUploadedAttachment: (attachment: StudioComposerAttachment) => void
  removeAttachment: (attachmentId: string) => void
  retainAttachments: (nextAttachments: StudioComposerAttachment[]) => void
  clearAttachments: () => void
}

export function useStudioComposerAttachments(): UseStudioComposerAttachmentsResult {
  const { t } = useI18n()
  const [attachments, setAttachments] = useState<StudioComposerAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const appendUploadedAttachment = useCallback((attachment: StudioComposerAttachment) => {
    setAttachments((current) => [...current, attachment])
    setAttachmentError(null)
  }, [])

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    setAttachmentError(null)
    const fileArray = Array.from(files).filter((file) => file.type.startsWith('image/'))
    debugStudioMessages('composer-image-files-received', {
      incomingCount: Array.from(files).length,
      imageCount: fileArray.length,
      existingAttachmentCount: attachments.length,
      names: fileArray.map((file) => file.name),
    })

    if (fileArray.length === 0) {
      setAttachmentError(t('reference.invalidFile'))
      debugStudioMessages('composer-image-files-rejected', {
        reason: 'no-image-files',
      })
      return []
    }

    debugStudioMessages('composer-image-files-queued', {
      queuedCount: fileArray.length,
      names: fileArray.map((file) => file.name),
    })

    try {
      for (const file of fileArray) {
        if (file.size > MAX_IMAGE_SIZE) {
          throw new Error(t('reference.maxSize', { size: MAX_IMAGE_SIZE / 1024 / 1024 }))
        }
      }

      const uploadedAttachments = await Promise.all(
        fileArray.map(async (file) => {
          debugStudioMessages('composer-image-upload-start', {
            name: file.name,
            type: file.type,
            size: file.size,
          })
          const uploaded = await uploadReferenceImage(file)
          debugStudioMessages('composer-image-upload-complete', {
            name: file.name,
            url: uploaded.url,
            mimeType: uploaded.mimeType,
            size: uploaded.size,
          })
          return createComposerImageAttachment({
            url: uploaded.url,
            name: file.name,
            mimeType: uploaded.mimeType,
            detail: 'low',
          })
        }),
      )

      setAttachments((current) => [...current, ...uploadedAttachments])
      debugStudioMessages('composer-image-attachments-appended', {
        attachmentCount: uploadedAttachments.length,
        names: uploadedAttachments.map((attachment) => attachment.name),
      })
      return uploadedAttachments
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('reference.processFailed'))
      debugStudioMessages('composer-image-upload-failed', {
        message: error instanceof Error ? error.message : t('reference.processFailed'),
      })
      return []
    }
  }, [attachments.length, t])

  const appendReferenceImages = useCallback((images: ReferenceImage[]) => {
    if (images.length === 0) {
      return []
    }

    const nextAttachments = images.map((image) => createComposerImageAttachment({
      url: image.url,
      name: extractNameFromUrl(image.url),
      detail: image.detail,
    }))
    setAttachments((current) => [...current, ...nextAttachments])
    setAttachmentError(null)
    return nextAttachments
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
    setAttachmentError(null)
  }, [])

  const retainAttachments = useCallback((nextAttachments: StudioComposerAttachment[]) => {
    setAttachments(nextAttachments)
    setAttachmentError(null)
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments([])
    setAttachmentError(null)
  }, [])

  return {
    attachments,
    attachmentError,
    fileInputRef,
    addImageFiles,
    appendReferenceImages,
    appendUploadedAttachment,
    removeAttachment,
    retainAttachments,
    clearAttachments,
  }
}
