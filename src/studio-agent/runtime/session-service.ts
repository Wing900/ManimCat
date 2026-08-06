import fs from 'node:fs'
import { createStudioSession } from '../domain/factories'
import type {
  StudioKind,
  StudioSession,
  StudioSessionSnapshot,
  StudioToolChoice,
} from '../domain/types'
import type { StudioPersistence } from '../persistence/studio-persistence'
import { createStudioSessionMetadata } from './session-config'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import { getDefaultStudioWorkspacePath } from '../workspace/default-studio-workspace'

export interface StudioCreateSessionInput {
  ownerId: string
  projectId: string
  directory?: string
  useDedicatedWorkspace?: boolean
  title?: string
  studioKind?: StudioKind
  agentType?: StudioSession['agentType']
  workspaceId?: string
  toolChoice?: StudioToolChoice
}

export interface StudioSessionService {
  createSession: (sessionInput: StudioCreateSessionInput) => Promise<StudioSession>
  getSession: (ownerId: string, sessionId: string) => Promise<StudioSession | null>
  getSessionSnapshot: (ownerId: string, sessionId: string) => Promise<StudioSessionSnapshot | null>
}

export function createStudioSessionService(input: {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
}): StudioSessionService {
  async function createSession(sessionInput: StudioCreateSessionInput): Promise<StudioSession> {
    const studioKind = sessionInput.studioKind ?? 'manim'
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

    const [messages, runs, renders] = await Promise.all([
      input.persistence.messageStore.listBySessionId(session.id),
      input.persistence.runStore.listBySessionId(ownerId, session.id),
      input.persistence.renderStore.listBySessionId(ownerId, session.id),
    ])

    return { session, messages, runs, renders }
  }

  return {
    createSession,
    getSession: (ownerId, sessionId) => input.persistence.sessionStore.getById(ownerId, sessionId),
    getSessionSnapshot,
  }
}

function getDefaultSessionTitle(studioKind: StudioKind): string {
  return studioKind === 'plot' ? 'Plot Studio Session' : 'Manim Studio Session'
}
