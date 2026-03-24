import { useCallback, useState } from 'react'
import { updateStudioSession } from '../api/studio-agent-api'
import type { StudioPermissionMode, StudioSession } from '../protocol/studio-agent-types'
import { parseStudioSlashCommand } from './command-parser'

interface UseStudioControlsInput {
  session: StudioSession | null
  onRun: (inputText: string) => Promise<void>
  onSessionUpdated: (session: StudioSession) => Promise<void>
}

export function useStudioControls({ session, onRun, onSessionUpdated }: UseStudioControlsInput) {
  const [pendingMode, setPendingMode] = useState<StudioPermissionMode | null>(null)
  const [isApplyingMode, setIsApplyingMode] = useState(false)

  const submitInput = useCallback(async (inputText: string) => {
    const command = parseStudioSlashCommand(inputText)
    if (!command) {
      await onRun(inputText)
      return { kind: 'run' as const }
    }

    if (command.type === 'permission-mode') {
      setPendingMode(command.mode)
      return { kind: 'control' as const }
    }

    await onRun(inputText)
    return { kind: 'run' as const }
  }, [onRun])

  const closePermissionModeModal = useCallback(() => {
    if (isApplyingMode) {
      return
    }
    setPendingMode(null)
  }, [isApplyingMode])

  const confirmPermissionMode = useCallback(async () => {
    if (!session || !pendingMode) {
      return
    }

    setIsApplyingMode(true)
    try {
      const updatedSession = await updateStudioSession({
        sessionId: session.id,
        permissionMode: pendingMode,
      })
      await onSessionUpdated(updatedSession)
      setPendingMode(null)
    } finally {
      setIsApplyingMode(false)
    }
  }, [onSessionUpdated, pendingMode, session])

  return {
    submitInput,
    permissionModeModal: {
      isOpen: pendingMode !== null,
      mode: pendingMode,
      isSubmitting: isApplyingMode,
      onClose: closePermissionModeModal,
      onConfirm: confirmPermissionMode,
    },
  }
}
