import { useCallback } from 'react'
import { createStudioRun } from '../api/studio-agent-api'
import { buildStudioCreateRunInput } from '../api/studio-run-request'
import type {
  StudioPermissionRequest,
  StudioRun,
  StudioSession,
  StudioSessionSnapshot,
  StudioUserMessage,
} from '../protocol/studio-agent-types'

interface UseStudioRunInput {
  session: StudioSession | null
  onUserMessageSubmitted: (message: StudioUserMessage) => void
  onRunStarted: (run: StudioRun, pendingPermissions: StudioPermissionRequest[]) => void
  onSnapshotLoaded: (snapshot: StudioSessionSnapshot, pendingPermissions: StudioPermissionRequest[]) => void
}

export function useStudioRun({ session, onUserMessageSubmitted, onRunStarted, onSnapshotLoaded }: UseStudioRunInput) {
  return useCallback(async (inputText: string) => {
    if (!session) {
      return
    }

    const optimisticMessage: StudioUserMessage = {
      id: `local-user-${Date.now()}`,
      sessionId: session.id,
      role: 'user',
      text: inputText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    onUserMessageSubmitted(optimisticMessage)

    const response = await createStudioRun(buildStudioCreateRunInput({
      session,
      inputText,
    }))

    const pendingPermissions = filterPermissionsForSession(response.pendingPermissions, session.id)

    onRunStarted(response.run, pendingPermissions)
    onSnapshotLoaded({
      session,
      messages: response.messages,
      runs: [response.run],
      tasks: response.tasks,
      works: response.works,
      workResults: response.workResults,
    }, pendingPermissions)
  }, [onRunStarted, onSnapshotLoaded, onUserMessageSubmitted, session])
}

function filterPermissionsForSession(requests: StudioPermissionRequest[], sessionId?: string | null) {
  if (!sessionId) {
    return []
  }
  return requests.filter((request) => request.sessionID === sessionId)
}
