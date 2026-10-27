import fs from 'node:fs'
import { createStudioAssistantMessage, createStudioSession, createStudioUserMessage } from '../domain/factories'
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
   * 把一个**浏览器已经持有、服务端从未见过**的会话写进来，让下一次 Run 拿到它被给定的上下文
   * （`STUDIO_DATA_MODE=client` 形态）。服务端已有的历史**绝不覆盖**：写入范围内已有消息就整段忽略，
   * 所以重放两次不会被抄成两份。带 `sceneId` 时检查与写入都只作用于该 Scene；不带时保持原来的
   * Session 级 Legacy 语义。返回实际写入的条数。
   */
  seedConversation: (seedInput: StudioConversationSeedInput) => Promise<number>
  /**
   * Removes one Session of this owner. Everything that belongs to it goes too (the schema cascades), and
   * `false` means there was nothing to remove — which is also the answer for another owner's Session, so
   * a delete never reveals that an id exists.
   */
  deleteSession: (ownerId: string, sessionId: string) => Promise<boolean>
}

export interface StudioConversationSeedInput {
  sessionId: string
  /**
   * Optional Scene scope of the replay. A Scene Run sees only messages of its own Scene, so a
   * browser-owned transcript replayed for one Scene has to land in that scope. Absent keeps the
   * Legacy Session-wide behaviour.
   */
  sceneId?: string
  conversation: StudioConversationSeedMessage[]
  agentType?: StudioSession['agentType']
}

/**
 * 浏览器重放的一条消息：只有角色与正文。id 与时间戳由服务端生成，所以客户端无法点名一条已存在的消息。
 */
export interface StudioConversationSeedMessage {
  role: 'user' | 'assistant'
  text: string
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

  /**
   * 助手正文存在循环回读它时所在的位置（`metadata.providerMessage.content`），所以喂进来的回复与
   * 现场产生的回复对模型来说没有区别。
   *
   * 时间戳在这里不是钟，而是顺序：`client` 形态下真正的时刻由浏览器持有，服务端只负责让这一段重放
   * 严格递增。否则连续几条会落在同一毫秒，平局再由随机 id 拆开——历史就被洗牌了。
   */
  async function seedConversation(seedInput: StudioConversationSeedInput): Promise<number> {
    // Idempotence follows the scope the replay writes into. A Scene Run must not be considered
    // already-seeded because a sibling Scene (or a Legacy Session row) has history; and a Legacy
    // replay keeps its Session-wide check exactly as before.
    const existing = seedInput.sceneId
      ? await input.persistence.messageStore.listBySceneId(seedInput.sceneId)
      : await input.persistence.messageStore.listBySessionId(seedInput.sessionId)
    if (existing.length > 0) {
      return 0
    }

    const seedStartedAt = Date.now()
    let offset = 0
    for (const message of seedInput.conversation) {
      const timestamp = new Date(seedStartedAt + offset).toISOString()
      offset += 1

      if (message.role === 'user') {
        const userMessage = createStudioUserMessage({
          sessionId: seedInput.sessionId,
          ...(seedInput.sceneId ? { sceneId: seedInput.sceneId } : {}),
          text: message.text,
        })
        userMessage.createdAt = timestamp
        userMessage.updatedAt = timestamp
        await input.persistence.messageStore.createUserMessage(userMessage)
      } else {
        const assistantMessage = createStudioAssistantMessage({
          sessionId: seedInput.sessionId,
          ...(seedInput.sceneId ? { sceneId: seedInput.sceneId } : {}),
          agent: seedInput.agentType ?? 'builder',
          metadata: { providerMessage: { content: message.text } },
        })
        assistantMessage.createdAt = timestamp
        assistantMessage.updatedAt = timestamp
        await input.persistence.messageStore.createAssistantMessage(assistantMessage)
      }
    }

    return seedInput.conversation.length
  }

  return {
    createSession,
    seedConversation,
    getSession: (ownerId, sessionId) => input.persistence.sessionStore.getById(ownerId, sessionId),
    getSessionSnapshot,
    deleteSession: (ownerId, sessionId) => input.persistence.sessionStore.delete(ownerId, sessionId),
  }
}

function getDefaultSessionTitle(studioKind: StudioKind): string {
  return studioKind === 'matplotlib' ? 'Plot Studio Session' : 'Manim Studio Session'
}
