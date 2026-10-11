import type { StudioEventStreamScope } from '../api/studio-agent-events'
import {
  readStudioExternalEventSceneId,
  type StudioExternalEvent,
} from '../protocol/studio-agent-events'

/** A connection captures its mapping; late frames never use a newer server binding. */
export function projectLocalStudioEvent(
  event: StudioExternalEvent,
  remoteScope: StudioEventStreamScope,
  localSessionId: string,
  sceneIds: ReadonlyMap<string, string>,
): StudioExternalEvent | null {
  if (event.type === 'studio.connected' || event.type === 'studio.heartbeat') return event
  if (!event.properties || event.properties.sessionId !== remoteScope.sessionId) return null

  const remoteSceneId = readStudioExternalEventSceneId(event)
  if (remoteScope.kind === 'scene' && remoteSceneId !== remoteScope.sceneId) return null
  const sceneId = remoteSceneId ? sceneIds.get(remoteSceneId) : undefined
  if (remoteSceneId && !sceneId) return null

  switch (event.type) {
    case 'run.updated':
      if (event.properties.run?.sessionId !== remoteScope.sessionId) return null
      return { ...event, properties: { ...event.properties, sessionId: localSessionId,
        run: { ...event.properties.run, sessionId: localSessionId, ...(sceneId ? { sceneId } : {}) },
      } }
    case 'render.updated':
      if (event.properties.render?.sessionId !== remoteScope.sessionId) return null
      return { ...event, properties: { ...event.properties, sessionId: localSessionId,
        render: { ...event.properties.render, sessionId: localSessionId, ...(sceneId ? { sceneId } : {}) },
      } }
    case 'assistant.text':
      return { ...event, properties: { ...event.properties, sessionId: localSessionId, ...(sceneId ? { sceneId } : {}) } }
    case 'tool.input-start':
      return { ...event, properties: { ...event.properties, sessionId: localSessionId, ...(sceneId ? { sceneId } : {}) } }
    case 'tool.call':
      return { ...event, properties: { ...event.properties, sessionId: localSessionId, ...(sceneId ? { sceneId } : {}) } }
    case 'tool.result':
      return { ...event, properties: { ...event.properties, sessionId: localSessionId, ...(sceneId ? { sceneId } : {}) } }
  }
}
