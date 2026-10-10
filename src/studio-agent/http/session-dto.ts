import type { StudioSession, StudioSessionSnapshot } from '../domain/types'
import { toPublicStudioRun } from './run-dto'
import { toPublicStudioRender } from './render-dto'
import { toPublicStudioScene } from './scene-dto'
import type { PublicStudioRun } from './run-dto'
import type { PublicStudioRender } from './render-dto'
import type { PublicStudioScene } from './scene-dto'

export type PublicStudioSession = Omit<StudioSession, 'ownerId' | 'directory' | 'parentSessionId'>

export interface PublicStudioSnapshot {
  session: PublicStudioSession
  messages: StudioSessionSnapshot['messages']
  runs: PublicStudioRun[]
  renders: PublicStudioRender[]
  scenes: PublicStudioScene[]
}

export function toPublicStudioSession(session: StudioSession): PublicStudioSession {
  const { ownerId: _ownerId, directory: _directory, parentSessionId: _parentSessionId, ...publicSession } = session
  return publicSession
}

export function toPublicStudioSnapshot(snapshot: StudioSessionSnapshot): PublicStudioSnapshot {
  return {
    session: toPublicStudioSession(snapshot.session),
    messages: snapshot.messages,
    runs: snapshot.runs.map(toPublicStudioRun),
    renders: snapshot.renders.map(toPublicStudioRender),
    scenes: snapshot.scenes.map(toPublicStudioScene),
  }
}

/* ------------------------------------------------------------------------------------------------
 * Scene public projection
 *
 * A Scene response is the end-user-facing read model, so it is built from an explicit whitelist of
 * public fields instead of by deleting one private field from a server record. Everything that can
 * carry server state — the internal failure text, the private source path, arbitrary Tool metadata,
 * model-supplied Tool input, absolute
 * filesystem paths — is either absent from these types or dropped by the converters. The legacy
 * Session DTOs and the Session SSE stream keep their existing shapes and are not routed through this
 * projection.
 * ---------------------------------------------------------------------------------------------- */
