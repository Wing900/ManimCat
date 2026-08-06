import type { StudioExternalEvent } from '../events/studio-event-adapter'
import type { StudioRender, StudioRun, StudioSession, StudioSessionSnapshot } from '../domain/types'

export type PublicStudioSession = Omit<StudioSession, 'ownerId' | 'directory' | 'parentSessionId'>
export type PublicStudioRun = Omit<StudioRun, 'ownerId'>
export type PublicStudioRender = Omit<StudioRender, 'ownerId'>

export interface PublicStudioSnapshot {
  session: PublicStudioSession
  messages: StudioSessionSnapshot['messages']
  runs: PublicStudioRun[]
  renders: PublicStudioRender[]
}

export function toPublicStudioSession(session: StudioSession): PublicStudioSession {
  const { ownerId: _ownerId, directory: _directory, parentSessionId: _parentSessionId, ...publicSession } = session
  return publicSession
}

export function toPublicStudioRun(run: StudioRun): PublicStudioRun {
  const { ownerId: _ownerId, ...publicRun } = run
  return publicRun
}

export function toPublicStudioRender(render: StudioRender): PublicStudioRender {
  const { ownerId: _ownerId, ...publicRender } = render
  return publicRender
}

export function toPublicStudioSnapshot(snapshot: StudioSessionSnapshot): PublicStudioSnapshot {
  return {
    session: toPublicStudioSession(snapshot.session),
    messages: snapshot.messages,
    runs: snapshot.runs.map(toPublicStudioRun),
    renders: snapshot.renders.map(toPublicStudioRender),
  }
}

export function toPublicStudioEvent(event: StudioExternalEvent): StudioExternalEvent {
  if (event.type !== 'render.updated') {
    return event
  }

  return {
    ...event,
    properties: {
      ...event.properties,
      render: toPublicStudioRender(event.properties.render as StudioRender),
    },
  }
}
