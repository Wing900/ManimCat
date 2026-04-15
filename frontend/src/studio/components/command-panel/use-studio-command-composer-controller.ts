import { useImperativeHandle, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, Ref } from 'react'
import { useStudioCommandAutocomplete } from '../../commands/ui/autocomplete/use-studio-command-autocomplete'
import { debugStudioMessages } from '../../agent-response/debug'
import type { StudioSession } from '../../protocol/studio-agent-types'
import type { StudioCommandPanelHandle } from '../StudioCommandPanel'
import { extractImageFilesFromDataTransfer } from './image-transfer'
import { submitStudioCommandComposer } from './submit-studio-command-composer'
import { useStudioCommandComposerAttachmentsController } from './use-studio-command-composer-attachments-controller'

interface UseStudioCommandComposerControllerInput {
  session: StudioSession | null
  disabled: boolean
  onRun: (inputText: string) => Promise<void> | void
  composerRef: Ref<StudioCommandPanelHandle>
}

export function useStudioCommandComposerController({
  session,
  disabled,
  onRun,
  composerRef,
}: UseStudioCommandComposerControllerInput) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const commandAutocomplete = useStudioCommandAutocomplete(input, session)

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

  const applySuggestion = (nextInput: string) => {
    setInput(nextInput)
    inputRef.current?.focus()
  }

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
      session,
      attachments: composerAttachments.attachmentsState.attachments,
      onRun,
      clearInput: () => setInput(''),
      restoreInput: setInput,
      clearAttachments: composerAttachments.attachmentsState.clearAttachments,
      retainAttachments: composerAttachments.attachmentsState.retainAttachments,
      focusInput: () => inputRef.current?.focus(),
      openImageInputMode: composerAttachments.imageInputCommand.openImageInputMode,
    })
  }

  return {
    input,
    inputRef,
    attachments: composerAttachments.attachmentsState.attachments,
    attachmentError: composerAttachments.attachmentsState.attachmentError,
    commandAutocomplete,
    imageInputCommand: composerAttachments.imageInputCommand,
    effectiveApplySuggestion: applySuggestion,
    focusInput,
    handlePaste,
    handleDocumentPaste,
    handleInputChange: composerAttachments.handleInputChange,
    handleRemoveAttachment: composerAttachments.handleRemoveAttachment,
    handleSubmit,
  }
}
