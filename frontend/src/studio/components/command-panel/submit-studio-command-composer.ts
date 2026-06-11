import { appendStudioReferenceImages } from '../../composer/attachments'
import type { StudioComposerAttachment } from '../../composer/types'

interface SubmitStudioCommandComposerOptions<TAttachment extends StudioComposerAttachment> {
  input: string
  disabled: boolean
  attachments: TAttachment[]
  onRun: (inputText: string) => Promise<void> | void
  clearInput: () => void
  restoreInput: (value: string) => void
  clearAttachments: () => void
  retainAttachments: (attachments: TAttachment[]) => void
  focusInput: () => void
}

export async function submitStudioCommandComposer<TAttachment extends StudioComposerAttachment>({
  input,
  disabled,
  attachments,
  onRun,
  clearInput,
  restoreInput,
  clearAttachments,
  retainAttachments,
  focusInput,
}: SubmitStudioCommandComposerOptions<TAttachment>) {
  const next = input.trim()
  if (!next || disabled) {
    return
  }

  clearInput()
  clearAttachments()
  const runInput = appendStudioReferenceImages(next, attachments)
  try {
    await onRun(runInput)
  } catch {
    restoreInput(next)
    retainAttachments(attachments)
  }
  focusInput()
}
