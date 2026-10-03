const SESSION_STORAGE_PREFIX = 'manimcat:studio'
const MAX_RECENT_SESSIONS = 12

function getLastSessionIdKey(studioKind: string) {
  return `${SESSION_STORAGE_PREFIX}:last-session-id:${studioKind}`
}

function getRecentSessionIdsKey(studioKind: string) {
  return `${SESSION_STORAGE_PREFIX}:recent-session-ids:${studioKind}`
}

/**
 * Selected Scene of one Session, used by the Cinema UI to restore the last Scene of a Session. Only
 * an opaque Scene id is stored: no message, no source file and no credential is ever written here.
 */
function getSceneSelectionKey(studioKind: string, sessionId: string) {
  return `${SESSION_STORAGE_PREFIX}:scene-selection:${studioKind}:${sessionId}`
}

export function readLastStudioSessionId(studioKind: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(getLastSessionIdKey(studioKind))
}

export function writeLastStudioSessionId(studioKind: string, sessionId: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(getLastSessionIdKey(studioKind), sessionId)
}

export function clearLastStudioSessionId(studioKind: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(getLastSessionIdKey(studioKind))
}

export function readRecentStudioSessionIds(studioKind: string): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  const raw = window.localStorage.getItem(getRecentSessionIdsKey(studioKind))
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

export function writeRecentStudioSessionIds(studioKind: string, sessionIds: string[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    getRecentSessionIdsKey(studioKind),
    JSON.stringify(sessionIds.slice(0, MAX_RECENT_SESSIONS)),
  )
}

export function rememberStudioSessionId(studioKind: string, sessionId: string) {
  const current = readRecentStudioSessionIds(studioKind)
  const next = [sessionId, ...current.filter((id) => id !== sessionId)]
  writeLastStudioSessionId(studioKind, sessionId)
  writeRecentStudioSessionIds(studioKind, next)
}

export function forgetStudioSessionId(studioKind: string, sessionId: string) {
  const current = readRecentStudioSessionIds(studioKind)
  const next = current.filter((id) => id !== sessionId)
  writeRecentStudioSessionIds(studioKind, next)

  if (readLastStudioSessionId(studioKind) === sessionId) {
    if (next[0]) {
      writeLastStudioSessionId(studioKind, next[0])
    } else {
      clearLastStudioSessionId(studioKind)
    }
  }
}

/** Last selected Scene of this Session, or null when nothing usable was stored. */
export function readStudioSceneSelection(studioKind: string, sessionId: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const value = window.localStorage.getItem(getSceneSelectionKey(studioKind, sessionId))
  return value && value.length > 0 ? value : null
}

/** Stores the selected Scene id, or clears it when the Scene is gone. */
export function writeStudioSceneSelection(
  studioKind: string,
  sessionId: string,
  sceneId: string | null,
) {
  if (typeof window === 'undefined') {
    return
  }

  const key = getSceneSelectionKey(studioKind, sessionId)
  if (sceneId) {
    window.localStorage.setItem(key, sceneId)
  } else {
    window.localStorage.removeItem(key)
  }
}

/** Drops the stored Scene selection of a Session that the history no longer holds. */
export function forgetStudioSceneSelection(studioKind: string, sessionId: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(getSceneSelectionKey(studioKind, sessionId))
}
