import { useCallback } from 'react'
import { getPendingStudioPermissions, replyStudioPermission } from '../api/studio-agent-api'
import type { StudioPermissionDecision, StudioPermissionRequest } from '../protocol/studio-agent-types'

interface UseStudioPermissionsInput {
  sessionId: string | null
  onReplyStarted: (requestId: string) => void
  onReplyFinished: (requests: StudioPermissionRequest[]) => void
  onError: (error: string) => void
  getFallbackRequests: () => StudioPermissionRequest[]
}

export function useStudioPermissions({
  sessionId,
  onReplyStarted,
  onReplyFinished,
  onError,
  getFallbackRequests,
}: UseStudioPermissionsInput) {
  const replyPermission = useCallback(async (requestId: string, reply: StudioPermissionDecision) => {
    onReplyStarted(requestId)

    try {
      const requests = await replyStudioPermission({ requestID: requestId, reply })
      onReplyFinished(filterPermissionsForSession(requests, sessionId))
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      onReplyFinished(getFallbackRequests())
    }
  }, [getFallbackRequests, onError, onReplyFinished, onReplyStarted, sessionId])

  const refreshPendingPermissions = useCallback(async () => {
    const requests = await getPendingStudioPermissions()
    return filterPermissionsForSession(requests, sessionId)
  }, [sessionId])

  return {
    replyPermission,
    refreshPendingPermissions,
  }
}

function filterPermissionsForSession(requests: StudioPermissionRequest[], sessionId?: string | null) {
  if (!sessionId) {
    return []
  }
  return requests.filter((request) => request.sessionID === sessionId)
}
