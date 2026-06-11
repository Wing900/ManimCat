import { useImperativeHandle, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, Ref } from 'react'
import { debugStudioMessages } from '../../agent-response/debug'
import type { StudioCommandPanelHandle } from '../StudioCommandPanel'
import { extractImageFilesFromDataTransfer } from './image-transfer'
import { submitStudioCommandComposer } from './submit-studio-command-composer'
import { useStudioCommandComposerAttachmentsController } from './use-studio-command-composer-attachments-controller'

interface UseStudioCommandComposerControllerInput {
  disabled: boolean
  onRun: (inputText: string) => Promise<void> | void
  composerRef: Ref<StudioCommandPanelHandle>
}

export function useStudioCommandComposerController({
  disabled,
  onRun,
  composerRef,
}: UseStudioCommandComposerControllerInput) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const focusInput = () => {
    if (disabled) {
      return
    }
    inputRef.current?.focus()
  }

  const composerAttachments = useStudioCommandComposerAttachmentsController({
    disabled,
    focusInput,
    setInput,
  })

  const handlePaste = async (event: ReactClipboardEvent<HTMLInputElement>) => {
    const imageFiles = extractImageFilesFromDataTransfer(event.clipboardData)
    debugStudioMessages('composer-paste-detected', {
      imageCount: imageFiles.length,
      target: 'input',
    })
    if (imageFiles.length === 0) {
      return
    }

    event.preventDefault()
    await addImageFilesToComposer(imageFiles)
  }

  const handleDocumentPaste = async (event: ClipboardEvent) => {
    const imageFiles = extractImageFilesFromDataTransfer(event.clipboardData)
    debugStudioMessages('composer-paste-detected', {
      imageCount: imageFiles.length,
      target: 'document',
    })
    if (imageFiles.length === 0) {
      return
    }

    await addImageFilesToComposer(imageFiles)
  }

  useImperativeHandle(composerRef, () => ({
    ingestImageFiles: async (files) => {
      await composerAttachments.addImageFilesToComposer(files)
    },
    appendPreviewAttachment: composerAttachments.appendPreviewAttachment,
    focusComposer: focusInput,
  }), [composerAttachments, disabled])

  const addImageFilesToComposer = composerAttachments.addImageFilesToComposer

  const handleSubmit = async () => {
    await submitStudioCommandComposer({
      input,
      disabled,
      attachments: composerAttachments.attachmentsState.attachments,
      onRun,
      clearInput: () => setInput(''),
      restoreInput: setInput,
      clearAttachments: composerAttachments.attachmentsState.clearAttachments,
      retainAttachments: composerAttachments.attachmentsState.retainAttachments,
      focusInput: () => inputRef.current?.focus(),
    })
  }

  return {
    input,
    inputRef,
    attachments: composerAttachments.attachmentsState.attachments,
    attachmentError: composerAttachments.attachmentsState.attachmentError,
    imageInputCommand: composerAttachments.imageInputCommand,
    focusInput,
    handlePaste,
    handleDocumentPaste,
    handleInputChange: composerAttachments.handleInputChange,
    handleRemoveAttachment: composerAttachments.handleRemoveAttachment,
    handleSubmit,
  }
}
