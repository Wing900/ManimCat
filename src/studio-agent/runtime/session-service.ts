import fs from 'node:fs'
import { createStudioSession } from '../domain/factories'
import type {
  StudioKind,
  StudioSession,
  StudioSessionSnapshot,
  StudioToolChoice,
} from '../domain/types'
import type { StudioPersistence } from '../infrastructure/persistence/studio-persistence'
import { createStudioSessionMetadata } from './session-config'
import type { StudioWorkspaceProvider } from '../infrastructure/workspace/studio-workspace-provider'
import { getDefaultStudioWorkspacePath } from '../infrastructure/workspace/default-studio-workspace'

export interface StudioCreateSessionInput {
  ownerId: string
  projectId: string
  directory?: string
  useDedicatedWorkspace?: boolean
  title?: string
  studioKind: StudioKind
  agentType?: StudioSession['agentType']
  workspaceId?: string
  toolChoice?: StudioToolChoice
}

export interface StudioSessionService {
  createSession: (sessionInput: StudioCreateSessionInput) => Promise<StudioSession>
  getSession: (ownerId: string, sessionId: string) => Promise<StudioSession | null>
  getSessionSnapshot: (ownerId: string, sessionId: string) => Promise<StudioSessionSnapshot | null>
  /**
   * Removes one Session of this owner. Everything that belongs to it goes too (the schema cascades), and
   * `false` means there was nothing to remove — which is also the answer for another owner's Session, so
   * a delete never reveals that an id exists.
   */
  deleteSession: (ownerId: string, sessionId: string) => Promise<boolean>
}

export function createStudioSessionService(input: {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
}): StudioSessionService {
  async function createSession(sessionInput: StudioCreateSessionInput): Promise<StudioSession> {
    const studioKind = sessionInput.studioKind
    const normalizedDirectory = input.workspaceProvider.normalizeDirectory(
      sessionInput.directory ?? getDefaultStudioWorkspacePath()
    )
    const session = createStudioSession({
      ownerId: sessionInput.ownerId,
      projectId: sessionInput.projectId,
      workspaceId: sessionInput.workspaceId,
      studioKind,
      agentType: sessionInput.agentType ?? 'builder',
      title: sessionInput.title ?? getDefaultSessionTitle(studioKind),
      directory: normalizedDirectory,
      metadata: createStudioSessionMetadata({
        existing: { studioKind },
        agentConfig: {
          toolChoice: sessionInput.toolChoice,
        },
      }),
    })

    if (sessionInput.useDedicatedWorkspace !== false) {
      session.directory = input.workspaceProvider.normalizeDirectory(
        `${studioKind}-studio/${session.id}`,
        { session },
      )
    }

    fs.mkdirSync(session.directory, { recursive: true })
    return input.persistence.sessionStore.create(session)
  }

  async function getSessionSnapshot(ownerId: string, sessionId: string): Promise<StudioSessionSnapshot | null> {
    const session = await input.persistence.sessionStore.getById(ownerId, sessionId)
    if (!session) {
      return null
    }

    const [messages, runs, renders, scenes] = await Promise.all([
      input.persistence.messageStore.listBySessionId(session.id),
      input.persistence.runStore.listBySessionId(ownerId, session.id),
      input.persistence.renderStore.listBySessionId(ownerId, session.id),
      input.persistence.sceneStore.listBySessionId(ownerId, session.id),
    ])

    return { session, messages, runs, renders, scenes }
  }

  return {
    createSession,
    getSession: (ownerId, sessionId) => input.persistence.sessionStore.getById(ownerId, sessionId),
    getSessionSnapshot,
    deleteSession: (ownerId, sessionId) => input.persistence.sessionStore.delete(ownerId, sessionId),
  }
}

function getDefaultSessionTitle(studioKind: StudioKind): string {
  return studioKind === 'matplotlib' ? 'Plot Studio Session' : 'Manim Studio Session'
}
