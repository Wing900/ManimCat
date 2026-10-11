import { StudioApiRequestError } from '../api/client'
import type { StudioRequestOptions } from '../api/studio-agent-api'
import type { StudioServerPort } from '../api/studio-server-port'
import { studioServerPort } from '../api/studio-server-port'
import type { StudioCinemaApiPort, StudioCinemaCancelResponse } from '../cinema/cinema-controller'
import type { StudioCinemaSessionGatewayApi } from '../cinema/session/studio-cinema-session-gateway'
import type {
  StudioAgentType,
  StudioCreateSceneRunInput,
  StudioCreateSessionInput,
  StudioKind,
  StudioMessage,
  StudioMessagePart,
  StudioScene,
  StudioSceneMessage,
  StudioScenePart,
  StudioSession,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'
import { createLocalStudioStore, type LocalScene, type LocalSession, type LocalStudioStore } from './local-studio-store'

/**
 * The two ports the Cinema depends on, as `STUDIO_DATA_MODE=client` serves them: **the browser holds
 * the identity, the server still does the work**.
 *
 * A translation is unavoidable, because the two sides name things differently by design. The UI knows
 * only local ids (`sess_<uuid>`, `scene_1`), which survive a server restart because the browser owns
 * them; the server knows only the ids it minted itself, which die with its process. The translation is
 * not cosmetic either: the server validates a Scene's stored `sourcePath` before a Run and materializes
 * the `code` it is handed, so both the keys of that map and the Run's own path have to be server ids —
 * otherwise the agent cannot read the sources it was just given.
 *
 * Healing is optimistic: the bound server Session is used directly, and only a `NOT_FOUND` triggers a
 * rebuild on the server (Session first, then every Scene this browser holds) followed by one retry.
 * Every other failure is a real failure and is rethrown untouched.
 */
export interface LocalFirstStudioPorts {
  sessionApi: StudioCinemaSessionGatewayApi
  sceneApi: StudioCinemaApiPort
}

export interface LocalFirstStudioPortsInput {
  store: LocalStudioStore
  server: StudioServerPort
  /** Fallback title for a Session created without one; the gateway always supplies its own. */
  defaultTitle?: string
  /** Fallback kind for a Session created without one; the gateway always supplies its own. */
  studioKind?: StudioKind
  projectId?: string
}

const DEFAULT_TITLE = 'Studio'
const DEFAULT_KIND: StudioKind = 'manim'
const DEFAULT_PROJECT_ID = 'manimcat-studio'
const DEFAULT_AGENT: StudioAgentType = 'builder'

export function createLocalFirstStudioPorts(input: LocalFirstStudioPortsInput): LocalFirstStudioPorts {
  const { store, server } = input

  /** The browser's own record of a Session, plus a refusal when this browser has never held one. */
  async function readLocal(sessionId: string): Promise<{ session: LocalSession; scenes: LocalScene[] }> {
    const session = await store.getSession(sessionId)
    if (!session) {
      throw new StudioApiRequestError('This browser has no such session', 'NOT_FOUND')
    }
    return { session, scenes: await store.listScenes(sessionId) }
  }

  /**
   * Runs `body` against the bound server Session, rebuilding it on the server when the server no
   * longer has it. Only `NOT_FOUND` heals: a rebuild on any other failure would hide the failure.
   */
  async function withServerSession<T>(sessionId: string, body: (serverSessionId: string) => Promise<T>): Promise<T> {
    const { session } = await readLocal(sessionId)

    if (session.serverSessionId) {
      try {
        return await body(session.serverSessionId)
      } catch (error) {
        if (!isNotFound(error)) {
          throw error
        }
      }
    }

    return body(await rebuildOnServer(sessionId))
  }

  /**
   * Stores this Session on the server again: the Session, then every Scene this browser holds, binding
   * each as it goes. The Scenes are created empty on purpose — their code is written by the next Run,
   * which carries the whole Session's sources.
   */
  async function rebuildOnServer(sessionId: string): Promise<string> {
    const { session, scenes } = await readLocal(sessionId)

    const created = await server.createSession({
      projectId: session.projectId || input.projectId || DEFAULT_PROJECT_ID,
      title: session.title || input.defaultTitle || DEFAULT_TITLE,
      studioKind: session.studioKind ?? input.studioKind ?? DEFAULT_KIND,
    })
    await store.bindServerSession(sessionId, created.id)

    for (const scene of scenes) {
      const serverScene = await server.createScene(created.id)
      await store.bindSceneServerId(sessionId, scene.id, serverScene.id)
    }

    return created.id
  }

  /** The server id of one local Scene, rebuilding the Session on the server when it has none yet. */
  async function serverSceneIdFor(sessionId: string, sceneId: string): Promise<string> {
    const { scenes } = await readLocal(sessionId)
    const scene = scenes.find((candidate) => candidate.id === sceneId)
    if (!scene) {
      throw new StudioApiRequestError('This browser has no such scene', 'NOT_FOUND')
    }
    if (!scene.serverSceneId) {
      await rebuildOnServer(sessionId)
      return serverSceneIdFor(sessionId, sceneId)
    }
    return scene.serverSceneId
  }

  /**
   * The whole Session's sources, keyed by server Scene id. Read from the store rather than from the
   * request: the browser owns the code, and a Run has to materialize every Scene it may import.
   */
  function sourcesFromStore(scenes: LocalScene[]): Record<string, string> {
    const sources: Record<string, string> = {}
    for (const scene of scenes) {
      if (scene.serverSceneId) {
        sources[scene.serverSceneId] = scene.code
      }
    }
    return sources
  }

  /** The transcript this browser owns, in order, as the server's seed shape. */
  async function localConversation(sessionId: string): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
    const messages = await store.listSessionMessages(sessionId)
    return messages
      .map((message) => ({
        role: message.role,
        text: message.role === 'user' ? message.text : readTextParts(message.parts),
      }))
      .filter((entry) => entry.text.trim().length > 0)
  }

  /**
   * Absorbs the assistant replies the server already knows into the local transcript, once each.
   * There is no stream here, so a read is where the browser learns what the server said; a repeat read
   * that finds the same text adds nothing.
   */
  async function absorbAssistantReplies(
    sessionId: string,
    serverMessages: Array<StudioMessage | StudioSceneMessage>,
    scope?: { serverSceneId: string; localSceneId: string },
  ): Promise<void> {
    const existing = await store.listSessionMessages(sessionId)
    const seen = new Set(existing.map(messageKey))
    let lastStamp = existing.at(-1)?.createdAt

    for (const message of serverMessages) {
      if (message.role !== 'assistant') {
        continue
      }

      const text = readAssistantText(message).trim()
      const key = `assistant:${text}`
      if (!text || seen.has(key)) {
        continue
      }
      seen.add(key)

      const serverScope = message.sceneId
      const localSceneId = scope && serverScope === scope.serverSceneId ? scope.localSceneId : undefined

      const recorded = buildAssistantMessage({
        sessionId,
        text,
        ...(localSceneId ? { sceneId: localSceneId } : {}),
        notBefore: lastStamp,
      })
      await store.appendMessage(recorded)
      lastStamp = recorded.createdAt
    }
  }

  async function sessionSnapshot(sessionId: string, options?: StudioRequestOptions): Promise<StudioSessionSnapshot> {
    return withServerSession(sessionId, async (serverSessionId) => {
      const snapshot = await server.getSessionSnapshot(serverSessionId, options)
      const { session, scenes } = await readLocal(sessionId)

      await absorbAssistantReplies(sessionId, snapshot.messages)

      return {
        ...snapshot,
        session: toLocalSession(session, snapshot.session),
        scenes: (snapshot.scenes ?? []).map((scene) => toLocalScene(scenes, sessionId, scene)),
        runs: (snapshot.runs ?? []).map((run) => ({
          ...run,
          sessionId,
          ...(run.sceneId ? { sceneId: localSceneIdOf(scenes, run.sceneId) ?? run.sceneId } : {}),
        })),
        renders: (snapshot.renders ?? []).map((render) => ({
          ...render,
          sessionId,
          ...(render.sceneId ? { sceneId: localSceneIdOf(scenes, render.sceneId) ?? render.sceneId } : {}),
        })),
        // The local transcript is the one that is displayed: it is what survives a server restart,
        // which is exactly when the server's own copy is thinner than the browser's.
        messages: mergeMessages(
          snapshot.messages.map((message) => toLocalScopedSessionMessage(scenes, sessionId, message)),
          (await store.listSessionMessages(sessionId)).map((message) => toSessionMessage(message)),
        ),
      }
    })
  }

  const sessionApi: StudioCinemaSessionGatewayApi = {
    createSession: async (createInput: StudioCreateSessionInput) => {
      const session = await store.createSession({
        kind: createInput.studioKind ?? input.studioKind ?? DEFAULT_KIND,
        title: createInput.title || input.defaultTitle || DEFAULT_TITLE,
      })

      const serverSessionId = await rebuildOnServer(session.id)
      const snapshot = await server.getSessionSnapshot(serverSessionId)

      return toLocalSession(session, snapshot.session)
    },

    getSessionSnapshot: (sessionId, options) => sessionSnapshot(sessionId, options),

    deleteSession: async (sessionId) => {
      const { session } = await readLocal(sessionId)
      if (session.serverSessionId) {
        try {
          await server.deleteSession(session.serverSessionId)
        } catch (error) {
          // The server has already forgotten it (a restart). The browser still has to delete it, and
          // that is not a failure of this call.
          if (!isNotFound(error)) {
            throw error
          }
        }
      }

      await store.deleteSession(sessionId)
      return true
    },
  }

  const sceneApi: StudioCinemaApiPort = {
    // The Scene port also reads a Session snapshot (that is its Session-scoped read), so it shares
    // this one implementation.
    getSessionSnapshot: (sessionId, options) => sessionSnapshot(sessionId, options),

    createScene: (sessionId, options) =>
      withServerSession(sessionId, async (serverSessionId) => {
        // The local store mints the id (`scene_1`, `scene_2`, ...) because that id is the Python module
        // stem other Scenes import: it has to be stable here, and the server's random id cannot be.
        const scene = await store.createScene(sessionId)
        const serverScene = await server.createScene(serverSessionId, options)
        await store.bindSceneServerId(sessionId, scene.id, serverScene.id)

        return {
          ...serverScene,
          id: scene.id,
          sessionId,
          position: scene.position,
          createdAt: scene.createdAt,
          updatedAt: scene.updatedAt,
        }
      }),

    reorderScenes: (sessionId, sceneIds) =>
      withServerSession(sessionId, async (serverSessionId) => {
        const serverSceneIds: string[] = []
        for (const sceneId of sceneIds) {
          serverSceneIds.push(await serverSceneIdFor(sessionId, sceneId))
        }

        const reordered = await server.reorderScenes(serverSessionId, serverSceneIds)
        await store.reorderScenes(sessionId, sceneIds)

        const { scenes } = await readLocal(sessionId)
        return reordered.map((scene) => ({
          ...scene,
          id: localSceneIdOf(scenes, scene.id) ?? scene.id,
          sessionId,
        }))
      }),

    getSceneSnapshot: (sessionId, sceneId, options) =>
      withServerSession(sessionId, async (serverSessionId) => {
        const serverSceneId = await serverSceneIdFor(sessionId, sceneId)
        const snapshot = await server.getSceneSnapshot(serverSessionId, serverSceneId, options)
        const { scenes } = await readLocal(sessionId)

        await absorbAssistantReplies(sessionId, snapshot.messages, { serverSceneId, localSceneId: sceneId })

        return {
          ...snapshot,
          scene: { ...snapshot.scene, id: sceneId, sessionId },
          runs: snapshot.runs.map((run) => ({
            ...run,
            sessionId,
            ...(run.sceneId ? { sceneId } : {}),
          })),
          renders: snapshot.renders.map((render) => ({
            ...render,
            sessionId,
            ...(render.sceneId ? { sceneId } : {}),
          })),
          messages: mergeSceneMessages(
            snapshot.messages.map((message) => toLocalScopedSceneMessage(scenes, sessionId, sceneId, message)),
            await store.listMessages(sessionId, sceneId),
          ),
        }
      }),

    createSceneRun: (sessionId, sceneId, runInput: StudioCreateSceneRunInput, options) =>
      withServerSession(sessionId, async (serverSessionId) => {
        const serverSceneId = await serverSceneIdFor(sessionId, sceneId)

        // What the browser just sent becomes the durable copy: the next Run (and any rebuild) reads the
        // sources from here instead of depending on this request arriving again.
        if (runInput.code) {
          for (const [localSceneId, code] of Object.entries(runInput.code)) {
            if (await store.getScene(sessionId, localSceneId)) {
              await store.updateSceneCode(sessionId, localSceneId, code)
            }
          }
        }

        const { scenes } = await readLocal(sessionId)
        const conversation = await localConversation(sessionId)

        const response = await server.createSceneRun(
          serverSessionId,
          serverSceneId,
          {
            ...runInput,
            code: sourcesFromStore(scenes),
            // The only context a just-restarted server can get: the server seeds it when it holds no
            // history for the Session, and ignores it when it does.
            ...(conversation.length ? { conversation } : {}),
          },
          options,
        )

        const recorded = buildUserMessage({
          sessionId,
          sceneId,
          text: runInput.inputText,
          notBefore: (await store.listSessionMessages(sessionId)).at(-1)?.createdAt,
        })
        await store.appendMessage(recorded)

        return {
          ...response,
          scene: { ...response.scene, id: sceneId, sessionId },
          run: { ...response.run, sessionId, ...(response.run.sceneId ? { sceneId } : {}) },
          messages: mergeSceneMessages(
            response.messages.map((message) => toLocalScopedSceneMessage(scenes, sessionId, sceneId, message)),
            await store.listMessages(sessionId, sceneId),
          ),
        }
      }),

    cancelRun: (runId): Promise<StudioCinemaCancelResponse> => server.cancelRun(runId),
  }

  return { sessionApi, sceneApi }
}

/**
 * One lazy instance for the two assembly points. The ports hold no state — every piece of it lives in
 * the store, which is IndexedDB — so sharing one instance only avoids re-opening the database per
 * call. Nothing is created until the first call, which is what lets the shape decision survive the
 * `GET /api/runtime-config` that resolves while the app is still booting.
 */
let sharedPorts: LocalFirstStudioPorts | null = null

export function localFirstStudioPorts(): LocalFirstStudioPorts {
  sharedPorts ??= createLocalFirstStudioPorts({ store: createLocalStudioStore(), server: studioServerPort })
  return sharedPorts
}

/** The server id of a local Scene, or null when this browser has never bound that server Scene. */
function localSceneIdOf(scenes: LocalScene[], serverSceneId: string): string | null {
  return scenes.find((scene) => scene.serverSceneId === serverSceneId)?.id ?? null
}

/** The server has already forgotten the Session, which is how that reaches this layer. */
function isNotFound(error: unknown): boolean {
  return error instanceof StudioApiRequestError && error.code === 'NOT_FOUND'
}

function toLocalSession(session: LocalSession, serverSession: StudioSession): StudioSession {
  return {
    ...serverSession,
    // The UI only ever sees the identity this browser owns: it survives a server restart, so reopening
    // the page shows the same Session instead of a new one.
    id: session.id,
    title: session.title || serverSession.title,
    ...(session.studioKind ? { studioKind: session.studioKind } : {}),
  }
}

function toLocalScene(scenes: LocalScene[], sessionId: string, serverScene: StudioScene): StudioScene {
  const scene = scenes.find(
    (candidate) => candidate.serverSceneId === serverScene.id || candidate.id === serverScene.id,
  )

  return {
    ...serverScene,
    id: scene?.id ?? serverScene.id,
    sessionId,
    position: scene?.position ?? serverScene.position,
    createdAt: scene?.createdAt ?? serverScene.createdAt,
    updatedAt: scene?.updatedAt ?? serverScene.updatedAt,
  }
}

/** Server ids become local ones, so everything a consumer sees is in one identity space. */
function toLocalScopedSessionMessage(
  scenes: LocalScene[],
  sessionId: string,
  message: StudioMessage,
): StudioMessage {
  const sceneId = message.sceneId ? localSceneIdOf(scenes, message.sceneId) : null

  return {
    ...message,
    sessionId,
    ...(sceneId ? { sceneId } : {}),
  }
}

function toLocalScopedSceneMessage(
  scenes: LocalScene[],
  sessionId: string,
  fallbackSceneId: string,
  message: StudioSceneMessage,
): StudioSceneMessage {
  const mapped = message.sceneId ? localSceneIdOf(scenes, message.sceneId) : null
  // Every message of a Scene snapshot belongs to that Scene, even when the row carries no scope.
  const sceneId = mapped ?? fallbackSceneId

  if (message.role === 'user') {
    return { ...message, sessionId, sceneId }
  }

  return {
    ...message,
    sessionId,
    parts: message.parts.map((part) => ({ ...part, sessionId })),
    sceneId,
  }
}

/** A local Scene message as a Session-level one; its parts are rebuilt because only text is stored. */
function toSessionMessage(message: StudioSceneMessage): StudioMessage {
  if (message.role === 'user') {
    return message
  }

  return {
    id: message.id,
    sessionId: message.sessionId,
    ...(message.sceneId ? { sceneId: message.sceneId } : {}),
    role: 'assistant',
    agent: message.agent,
    parts: [
      {
        id: `${message.id}_text`,
        messageId: message.id,
        sessionId: message.sessionId,
        type: 'text',
        text: readTextParts(message.parts),
      },
    ],
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  }
}

function buildUserMessage(input: {
  sessionId: string
  sceneId?: string
  text: string
  notBefore?: string
}): StudioSceneMessage {
  const timestamp = strictlyAfter(input.notBefore)

  return {
    id: `msg_${crypto.randomUUID()}`,
    sessionId: input.sessionId,
    ...(input.sceneId ? { sceneId: input.sceneId } : {}),
    role: 'user',
    text: input.text,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function buildAssistantMessage(input: {
  sessionId: string
  sceneId?: string
  text: string
  notBefore?: string
}): StudioSceneMessage {
  const id = `msg_${crypto.randomUUID()}`
  const timestamp = strictlyAfter(input.notBefore)

  return {
    id,
    sessionId: input.sessionId,
    ...(input.sceneId ? { sceneId: input.sceneId } : {}),
    role: 'assistant',
    agent: DEFAULT_AGENT,
    parts: [{ id: `${id}_text`, messageId: id, sessionId: input.sessionId, type: 'text', text: input.text }],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/**
 * A stamp strictly after `notBefore`. A transcript's order is carried by its timestamps, and several
 * messages written in the same millisecond would otherwise fall back to comparing random ids — which
 * shuffles the history a Run is replayed.
 */
function strictlyAfter(notBefore: string | undefined): string {
  const now = new Date().toISOString()
  if (!notBefore || now > notBefore) {
    return now
  }
  return new Date(Date.parse(notBefore) + 1).toISOString()
}

function readTextParts(parts: Array<StudioMessagePart | StudioScenePart>): string {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim()
}

function readAssistantText(message: StudioMessage | StudioSceneMessage): string {
  return message.role === 'assistant' ? readTextParts(message.parts) : ''
}

/** Deduplication key: the same reply may exist on both sides, and it must still appear once. */
function messageKey(message: StudioMessage | StudioSceneMessage): string {
  return message.role === 'user' ? `user:${message.text}` : `assistant:${readTextParts(message.parts)}`
}

function mergeMessages(serverMessages: StudioMessage[], localMessages: StudioMessage[]): StudioMessage[] {
  const seen = new Set(serverMessages.map(messageKey))
  return [...serverMessages, ...localMessages.filter((message) => !seen.has(messageKey(message)))]
}

function mergeSceneMessages(
  serverMessages: StudioSceneMessage[],
  localMessages: StudioSceneMessage[],
): StudioSceneMessage[] {
  const seen = new Set(serverMessages.map(messageKey))
  return [...serverMessages, ...localMessages.filter((message) => !seen.has(messageKey(message)))]
}
