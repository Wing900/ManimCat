import { appendStudioReferenceImages } from '../../composer/attachments'
import { resolveStudioCommand } from '../../commands/resolve-studio-command'
import type { StudioSession } from '../../protocol/studio-agent-types'

interface SubmitStudioCommandComposerOptions<TAttachment> {
  input: string
  disabled: boolean
  session: StudioSession | null
  attachments: TAttachment[]
  onRun: (inputText: string) => Promise<void> | void
  clearInput: () => void
  restoreInput: (value: string) => void
  clearAttachments: () => void
  retainAttachments: (attachments: TAttachment[]) => void
  focusInput: () => void
  openImageInputMode: () => void
}

export async function submitStudioCommandComposer<TAttachment>({
  input,
  disabled,
  session,
  attachments,
  onRun,
  clearInput,
  restoreInput,
  clearAttachments,
  retainAttachments,
  focusInput,
  openImageInputMode,
}: SubmitStudioCommandComposerOptions<TAttachment>) {
  const next = input.trim()
  if (!next || disabled) {
    return
  }

  const localCommand = resolveStudioCommand(next)
  if (localCommand?.definition.scope === 'local') {
    clearInput()
    await localCommand.definition.execute(localCommand.command as never, {
      session,
      openHistory: () => {},
      createSession: async () => {},
      setPendingMode: () => {},
      openImageInputMode,
      runCommandInput: async (inputText: string) => {
        await onRun(inputText)
      },
    })
    focusInput()
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
