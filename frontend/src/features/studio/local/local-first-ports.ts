import { StudioApiRequestError } from '../api/client'
import type { StudioRequestOptions } from '../api/studio-agent-api'
import type { StudioServerPort } from '../api/studio-server-port'
import { studioServerPort } from '../api/studio-server-port'
import { resolveStudioEventStreamScope, subscribeStudioEvents } from '../api/studio-agent-events'
import type { StudioEventSubscriptionOptions, StudioEventStreamScope } from '../api/studio-agent-events'
import { projectLocalStudioEvent } from './local-event-identity'
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
  StudioRun,
  StudioSceneSnapshot,
} from '../protocol/studio-agent-types'
import { createLocalStudioStore, type LocalScene, type LocalSession, type LocalStudioStore } from './local-studio-store'
import { createLocalConversationJournal } from './local-conversation-journal'

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
  events: { subscribe: (options: StudioEventSubscriptionOptions) => Promise<void> }
}

export interface LocalFirstStudioPortsInput {
  store: LocalStudioStore
  server: StudioServerPort
  subscribeEvents?: typeof subscribeStudioEvents
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
  const rebuilds = new Map<string, Promise<string>>()
  const pendingUsers = new Map<string, StudioSceneMessage>()
  const journal = createLocalConversationJournal(store)
  /** Server Runs this browser has seen, and the local identity each one projects to. */
  const runIdentities = new Map<string, RunIdentity>()

  function rememberRun(
    run: { id: string; sessionId: string; sceneId?: string },
    local: { sessionId: string; sceneId?: string },
    remote: { sessionId: string; sceneId?: string },
  ): void {
    runIdentities.set(run.id, {
      sessionId: local.sessionId,
      ...(local.sceneId ? { sceneId: local.sceneId } : {}),
      serverSessionId: remote.sessionId,
      ...(remote.sceneId ? { serverSceneId: remote.sceneId } : {}),
    })
  }

  /** The browser's own record of a Session, plus a refusal when this browser has never held one. */
  async function readLocal(sessionId: string): Promise<{ session: LocalSession; scenes: LocalScene[] }> {
    const [session, scenes] = await Promise.all([store.getSession(sessionId), store.listScenes(sessionId)])
    if (!session) {
      throw new StudioApiRequestError('This browser has no such session', 'NOT_FOUND')
    }
    return { session, scenes }
  }

  /**
   * A Session snapshot assembled entirely from IndexedDB. Restoring or listing history must never
   * depend on the server being reachable: the browser owns the Session, its Scenes, its ids and its
   * full structured messages, so a restart or an outage cannot make them disappear from the UI.
   * No Run is claimed here: local rows are not liveness information, and this snapshot is not an
   * authoritative server read.
   */
  async function localSessionSnapshot(sessionId: string): Promise<StudioSessionSnapshot> {
    const { session, scenes } = await readLocal(sessionId)
    return {
      session: toStandaloneLocalSession(session),
      scenes: scenes.map(toStandaloneLocalScene),
      messages: (await store.listSessionMessages(sessionId)).map(toSessionMessage),
      runs: [],
      renders: [],
    }
  }

  /**
   * A Scene snapshot assembled from IndexedDB after the server read failed. It keeps the selected
   * Scene's full structured history and local identity, and deliberately carries no binding marker:
   * only a real successful server read or rebuild can prove which server binding is current.
   */
  async function localSceneSnapshot(sessionId: string, sceneId: string): Promise<StudioSceneSnapshot> {
    const scene = await store.getScene(sessionId, sceneId)
    if (!scene) {
      throw new StudioApiRequestError('This browser has no such scene', 'NOT_FOUND')
    }
    return {
      scene: toStandaloneLocalScene(scene),
      messages: await store.listMessages(sessionId, sceneId),
      runs: [],
      renders: [],
    }
  }

  /**
   * Runs `body` against the bound server Session, rebuilding it on the server when the server no
   * longer has it. Only `NOT_FOUND` heals: a rebuild on any other failure would hide the failure.
   */
  async function withServerSession<T>(
    sessionId: string,
    body: (serverSessionId: string, context: { session: LocalSession; scenes: LocalScene[] }) => Promise<T>,
  ): Promise<T> {
    const rebuilding = rebuilds.get(sessionId)
    if (rebuilding) await rebuilding
    const context = await readLocal(sessionId)
    const { session } = context

    if (session.serverSessionId) {
      try {
        return await body(session.serverSessionId, context)
      } catch (error) {
        if (!isNotFound(error)) {
          throw error
        }
      }
    }

    const serverSessionId = await rebuildOnServer(sessionId, session.serverSessionId)
    return body(serverSessionId, await readLocal(sessionId))
  }

  /**
   * Stores this Session on the server again: the Session, then every Scene this browser holds, binding
   * each as it goes. The Scenes are created empty on purpose — their code is written by the next Run,
   * which carries the whole Session's sources.
   */
  function rebuildOnServer(sessionId: string, previousServerId?: string): Promise<string> {
    const existing = rebuilds.get(sessionId)
    if (existing) return existing
    const pending = restoreServerSession(sessionId, previousServerId).finally(() => {
      if (rebuilds.get(sessionId) === pending) rebuilds.delete(sessionId)
    })
    rebuilds.set(sessionId, pending)
    return pending
  }

  async function restoreServerSession(sessionId: string, previousServerId?: string): Promise<string> {
    const { session, scenes } = await readLocal(sessionId)
    if (previousServerId && session.serverSessionId && session.serverSessionId !== previousServerId) {
      return session.serverSessionId
    }

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

  /** The selected Scene's transcript, in order, as the server's context seed shape. */
  async function localConversation(
    sessionId: string,
    sceneId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
    const stored = await store.listSessionMessages(sessionId)
    const byId = new Map(
      stored.filter(message => message.sceneId === sceneId).map(message => [message.id, message]),
    )
    for (const pending of pendingUsers.values()) {
      if (pending.sessionId === sessionId && pending.sceneId === sceneId && !byId.has(pending.id)) {
        byId.set(pending.id, pending)
      }
    }
    return [...byId.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((message) => ({
        role: message.role,
        text: message.role === 'user' ? message.text : readTextParts(message.parts),
      }))
      .filter((entry) => entry.text.trim().length > 0)
  }

  /**
   * Absorbs the records the server already knows into the local transcript, by stable message id.
   * A reply is never recognised by its text: two equal replies with different ids are two replies.
   */
  function absorbAssistantReplies(
    sessionId: string,
    serverMessages: Array<StudioMessage | StudioSceneMessage>,
    runs: StudioRun[],
    scope?: { serverSceneId: string; localSceneId: string },
  ): Promise<void> {
    return saveCompletedReplies(sessionId, serverMessages, runs, scope)
  }

  async function saveCompletedReplies(
    sessionId: string,
    serverMessages: Array<StudioMessage | StudioSceneMessage>,
    runs: StudioRun[],
    scope?: { serverSceneId: string; localSceneId: string },
  ): Promise<void> {
    const existing = await store.listSessionMessages(sessionId)
    const known = new Set(existing.map(message => message.id))
    const finishedUsers: string[] = []
    const { scenes } = await readLocal(sessionId)
    for (const [runId, pending] of pendingUsers) {
      if (pending.sessionId !== sessionId || (scope && pending.sceneId !== scope.localSceneId)) continue
      if (!runs.some(run => run.id === runId && ['completed', 'failed', 'cancelled'].includes(run.status))) continue
      finishedUsers.push(runId)
      if (!known.has(pending.id)) {
        await journal.append(pending)
        known.add(pending.id)
      }
    }

    for (const message of serverMessages) {
      const localSceneId = scope && message.sceneId === scope.serverSceneId
        ? scope.localSceneId
        : message.sceneId ? localSceneIdOf(scenes, message.sceneId) : undefined
      const recorded = message.role === 'user'
        ? { ...message, sessionId, ...(localSceneId ? { sceneId: localSceneId } : {}) } as StudioSceneMessage
        : toLocalScopedAssistantMessage(sessionId, localSceneId ?? undefined, message)
      // The snapshot is not authoritative by itself: re-read and merge at execution time so a newer
      // streamed row queued in between is never overwritten by this older projection.
      await journal.update(recorded, (next, current) => preferMessage(next, current))
    }
    for (const runId of finishedUsers) pendingUsers.delete(runId)
  }

  async function sessionSnapshot(sessionId: string, options?: StudioRequestOptions): Promise<StudioSessionSnapshot> {
    try {
      return await withServerSession(sessionId, async (serverSessionId) => {
        const snapshot = await server.getSessionSnapshot(serverSessionId, options)
        const { session, scenes } = await readLocal(sessionId)

        for (const run of snapshot.runs ?? []) {
          const localSceneId = run.sceneId ? localSceneIdOf(scenes, run.sceneId) : null
          if (run.sceneId && !localSceneId) continue
          rememberRun(
            run,
            { sessionId, ...(localSceneId ? { sceneId: localSceneId } : {}) },
            { sessionId: serverSessionId, ...(run.sceneId ? { sceneId: run.sceneId } : {}) },
          )
        }

        await absorbAssistantReplies(sessionId, snapshot.messages, snapshot.runs)

        const remoteScenes = (snapshot.scenes ?? []).map((scene) => toLocalScene(scenes, sessionId, scene))
        const presentSceneIds = new Set(remoteScenes.map((scene) => scene.id))
        // The browser owns its Scenes. A thinner server index (or one that never saw a local Scene)
        // must not make a Scene the user still holds disappear from the Session list.
        const mergedScenes = [
          ...remoteScenes,
          ...scenes.filter((scene) => !presentSceneIds.has(scene.id)).map(toStandaloneLocalScene),
        ].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))

        return {
          ...snapshot,
          session: toLocalSession(session, snapshot.session),
          scenes: mergedScenes,
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
    } catch (error) {
      // A refresh is optional; the browser-owned Session is not. Only an abort (the caller no longer
      // wants an answer) propagates; every other failure falls back to the durable local snapshot.
      if (isAbortError(error)) throw error
      return localSessionSnapshot(sessionId)
    }
  }

  const sessionApi: StudioCinemaSessionGatewayApi = {
    createSession: async (createInput: StudioCreateSessionInput) => {
      const session = await store.createSession({
        kind: createInput.studioKind ?? input.studioKind ?? DEFAULT_KIND,
        title: createInput.title || input.defaultTitle || DEFAULT_TITLE,
      })

      const created = await server.createSession({
        projectId: createInput.projectId || input.projectId || DEFAULT_PROJECT_ID,
        title: session.title || input.defaultTitle || DEFAULT_TITLE,
        studioKind: session.studioKind ?? input.studioKind ?? DEFAULT_KIND,
        agentType: createInput.agentType ?? DEFAULT_AGENT,
      })
      await store.bindServerSession(session.id, created.id)

      return toLocalSession(session, created)
    },

    // Restore and history are IndexedDB-first: never wait on the server here. `sessionSnapshot`
    // stays private to background terminal synchronization.
    getSessionSnapshot: async (sessionId, options) => {
      if (options?.signal?.aborted) throw new DOMException('Session snapshot aborted', 'AbortError')
      return localSessionSnapshot(sessionId)
    },

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
    // The Scene port also reads a Session snapshot (that is its Session-scoped read), and it is
    // IndexedDB-first for the same reason: a hanging server must not hide local history.
    getSessionSnapshot: async (sessionId, options) => {
      if (options?.signal?.aborted) throw new DOMException('Session snapshot aborted', 'AbortError')
      return localSessionSnapshot(sessionId)
    },

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

    getSceneSnapshot: async (sessionId, sceneId, options) => {
      try {
        return await withServerSession(sessionId, async (serverSessionId, { scenes }) => {
          const scene = scenes.find(candidate => candidate.id === sceneId)
          if (!scene?.serverSceneId) {
            throw new StudioApiRequestError('This browser has no bound server scene', 'NOT_FOUND')
          }
          const serverSceneId = scene.serverSceneId
          const snapshot = await server.getSceneSnapshot(serverSessionId, serverSceneId, options)

          for (const run of snapshot.runs) {
            rememberRun(
              run,
              { sessionId, sceneId },
              { sessionId: serverSessionId, ...(run.sceneId ? { sceneId: serverSceneId } : {}) },
            )
          }

          await absorbAssistantReplies(sessionId, snapshot.messages, snapshot.runs, { serverSceneId, localSceneId: sceneId })

          return {
            ...snapshot,
            // Execution binding identity of the read that actually answered. A changed marker tells
            // the Cinema that Runs from the previous server Session cannot still be alive; an
            // identical one proves nothing changed. It is not browser identity and never model input.
            serverBindingId: `${serverSessionId}:${serverSceneId}`,
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
        })
      } catch (error) {
        // The selected Scene's durable history is local. A failed refresh returns it, without the
        // binding marker (no successful server read proved one) and without inventing live Runs.
        if (isAbortError(error)) throw error
        return localSceneSnapshot(sessionId, sceneId)
      }
    },

    createSceneRun: (sessionId, sceneId, runInput: StudioCreateSceneRunInput, options) =>
      withServerSession(sessionId, async (serverSessionId) => {
        const serverSceneId = await serverSceneIdFor(sessionId, sceneId)

        // What the browser just sent becomes the durable copy: the next Run (and any rebuild) reads the
        // sources from here instead of depending on this request arriving again.
        if (runInput.code) {
          for (const [localSceneId, code] of Object.entries(runInput.code)) {
            const existing = await store.getScene(sessionId, localSceneId)
            if (existing && existing.code !== code) {
              await store.updateSceneCode(sessionId, localSceneId, code)
            }
          }
        }

        const { scenes } = await readLocal(sessionId)
        const conversation = await localConversation(sessionId, sceneId)

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

        const acceptedUser = response.messages.find(message => message.role === 'user')
        const recorded = acceptedUser ? toLocalScopedSceneMessage(scenes, sessionId, sceneId, acceptedUser) : buildUserMessage({
          sessionId,
          sceneId,
          text: runInput.inputText,
          notBefore: (await store.listSessionMessages(sessionId)).at(-1)?.createdAt,
        })
        rememberRun(
          response.run,
          { sessionId, sceneId },
          { sessionId: serverSessionId, ...(response.run.sceneId ? { sceneId: serverSceneId } : {}) },
        )
        pendingUsers.set(response.run.id, recorded)
        // The accepted user message is durable before the caller can see the accepted Run.
        await journal.append(recorded)

        return {
          ...response,
          // The accepted Run lives on the binding that actually admitted it; this is the marker a
          // later snapshot compares against to interrupt Runs the old binding can no longer own.
          serverBindingId: `${serverSessionId}:${serverSceneId}`,
          scene: { ...response.scene, id: sceneId, sessionId },
          run: { ...response.run, sessionId, ...(response.run.sceneId ? { sceneId } : {}) },
          messages: mergeSceneMessages(
            response.messages.map((message) => toLocalScopedSceneMessage(scenes, sessionId, sceneId, message)),
            await store.listMessages(sessionId, sceneId),
          ),
        }
      }),

    cancelRun: async (runId): Promise<StudioCinemaCancelResponse> => {
      const response = await server.cancelRun(runId)
      const remoteRun = asRunRecord(response.run)
      const identity = remoteRun ? runIdentities.get(remoteRun.id) : undefined
      if (
        !remoteRun
        || remoteRun.id !== runId
        || !identity
        || identity.serverSessionId !== remoteRun.sessionId
        || identity.serverSceneId !== remoteRun.sceneId
      ) {
        // Unknown or mismatched: hand back exactly what the server said, so identity validation
        // rejects genuinely foreign data instead of this layer blessing it.
        return response
      }
      return {
        ...response,
        run: {
          ...(response.run as Record<string, unknown>),
          sessionId: identity.sessionId,
          ...(identity.sceneId ? { sceneId: identity.sceneId } : {}),
        },
      }
    },
  }

  const events: LocalFirstStudioPorts['events'] = {
    subscribe: (options) => {
      const localScope = resolveStudioEventStreamScope(options)
      return (input.subscribeEvents ?? subscribeStudioEvents)({
        ...options,
        resolveConnection: async () => {
          const rebuilding = rebuilds.get(localScope.sessionId)
          if (rebuilding) await rebuilding
          let context = await readLocal(localScope.sessionId)
          if (options.signal.aborted) throw new DOMException('Scene subscription aborted', 'AbortError')
          const selected = localScope.kind === 'scene'
            ? context.scenes.find(scene => scene.id === localScope.sceneId)
            : null
          if (localScope.kind === 'scene' && !selected) {
            throw new StudioApiRequestError('This browser has no such scene', 'NOT_FOUND')
          }
          if (!context.session.serverSessionId || (selected && !selected.serverSceneId)) {
            await rebuildOnServer(localScope.sessionId)
            context = await readLocal(localScope.sessionId)
          }
          const serverSessionId = context.session.serverSessionId
          const serverSceneId = localScope.kind === 'scene'
            ? context.scenes.find(scene => scene.id === localScope.sceneId)?.serverSceneId
            : undefined
          if (!serverSessionId || (localScope.kind === 'scene' && !serverSceneId)) {
            throw new StudioApiRequestError('Scene server binding is missing', 'NOT_FOUND')
          }
          const scope: StudioEventStreamScope = localScope.kind === 'scene'
            ? { kind: 'scene', sessionId: serverSessionId, sceneId: serverSceneId! }
            : { kind: 'session', sessionId: serverSessionId }
          const sceneIds = new Map(context.scenes.flatMap(scene => scene.serverSceneId ? [[scene.serverSceneId, scene.id] as const] : []))
          return { scope, onEvent: (event) => {
            const projected = projectLocalStudioEvent(event, scope, localScope.sessionId, sceneIds)
            if (projected) {
              const sceneId = projected.properties && 'sceneId' in projected.properties
                ? projected.properties.sceneId
                : undefined
              const messageEvent = ['assistant.text', 'tool.input-start', 'tool.call', 'tool.result'].includes(projected.type)
              if (messageEvent && sceneId) {
                // The event reaches the UI only after its full structured message is in IndexedDB.
                void journal.applyEvent(localScope.sessionId, sceneId, projected)
                  .catch(error => console.error('Local conversation event save failed', error))
                  .then(() => options.onEvent(projected))
              } else {
                options.onEvent(projected)
              }
              if (projected.type === 'run.updated') {
                const run = projected.properties.run
                const scene = run?.sceneId ? context.scenes.find(candidate => candidate.id === run.sceneId) : undefined
                if (run) {
                  rememberRun(
                    run,
                    { sessionId: localScope.sessionId, ...(run.sceneId ? { sceneId: run.sceneId } : {}) },
                    {
                      sessionId: serverSessionId,
                      ...(scene?.serverSceneId ? { sceneId: scene.serverSceneId } : {}),
                    },
                  )
                }
                if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
                  // After the journal queue drains, reconcile the terminal snapshot in the background.
                  void journal.drain(localScope.sessionId)
                    .then(() => sessionSnapshot(localScope.sessionId))
                    .catch(error => console.error('Local conversation save failed', error))
                }
              }
            }
          } }
        },
        onNotFound: async (scope) => {
          await rebuildOnServer(localScope.sessionId, scope.sessionId)
        },
      })
    },
  }

  return { sessionApi, sceneApi, events }
}

/**
 * One lazy instance shares the IndexedDB store and in-flight server restoration between HTTP and
 * event subscriptions. Durable state stays in IndexedDB. Nothing is created until the first call,
 * which is what lets the shape decision survive the
 * `GET /api/runtime-config` that resolves while the app is still booting.
 */
let sharedPorts: LocalFirstStudioPorts | null = null

export function localFirstStudioPorts(): LocalFirstStudioPorts {
  sharedPorts ??= createLocalFirstStudioPorts({ store: createLocalStudioStore(), server: studioServerPort })
  return sharedPorts
}

interface RunIdentity {
  sessionId: string
  sceneId?: string
  serverSessionId: string
  serverSceneId?: string
}

/** A server Run shape, or null when the payload is not one; malformed data is never coerced. */
function asRunRecord(value: unknown): { id: string; sessionId: string; sceneId?: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.sessionId !== 'string') return null
  if (record.sceneId !== undefined && typeof record.sceneId !== 'string') return null
  return {
    id: record.id,
    sessionId: record.sessionId,
    ...(typeof record.sceneId === 'string' ? { sceneId: record.sceneId } : {}),
  }
}

/** The server id of a local Scene, or null when this browser has never bound that server Scene. */
function localSceneIdOf(scenes: LocalScene[], serverSceneId: string): string | null {
  return scenes.find((scene) => scene.serverSceneId === serverSceneId)?.id ?? null
}

/** The server has already forgotten the Session, which is how that reaches this layer. */
function isNotFound(error: unknown): boolean {
  return error instanceof StudioApiRequestError && error.code === 'NOT_FOUND'
}

/** An aborted read belongs to a caller that no longer wants it; it must not look like a transport fallback. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
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

/** The local Session record in the protocol shape, for snapshots that never reached the server. */
function toStandaloneLocalSession(session: LocalSession): StudioSession {
  // `directory` is a server-side concept the browser does not own; the local record has no value for
  // it, and no frontend consumer reads it.
  return { ...session, directory: '' }
}

/** The protocol Scene shape of a local row, without its local-only `code` and server binding extras. */
function toStandaloneLocalScene(scene: LocalScene): StudioScene {
  return {
    id: scene.id,
    sessionId: scene.sessionId,
    position: scene.position,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
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

function toLocalScopedAssistantMessage(
  sessionId: string,
  sceneId: string | undefined,
  message: StudioMessage | StudioSceneMessage,
): StudioSceneMessage {
  if (message.role === 'user') {
    return { ...message, sessionId, ...(sceneId ? { sceneId } : {}) } as StudioSceneMessage
  }
  return {
    id: message.id,
    sessionId,
    ...(sceneId ? { sceneId } : {}),
    role: 'assistant',
    agent: message.agent,
    parts: message.parts.map(part => ({ ...part, messageId: message.id, sessionId })) as StudioScenePart[],
    ...(message.summary ? { summary: message.summary } : {}),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
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

/** A local Scene message as a Session-level one, keeping every structured part and stable id. */
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
    // Scene parts are the persisted public projection of the same parts. The narrower Scene Tool
    // state is widened without rebuilding or flattening anything.
    parts: message.parts.map(part => ({ ...part, sessionId: message.sessionId })) as StudioMessagePart[],
    ...(message.summary ? { summary: message.summary } : {}),
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

function mergeMessages(serverMessages: StudioMessage[], localMessages: StudioMessage[]): StudioMessage[] {
  return mergeById(serverMessages, localMessages)
}

function mergeSceneMessages(
  serverMessages: StudioSceneMessage[],
  localMessages: StudioSceneMessage[],
): StudioSceneMessage[] {
  return mergeById(serverMessages, localMessages)
}

/** Union by stable message id; local records missing from a thinner server snapshot survive. */
function mergeById<T extends StudioMessage | StudioSceneMessage>(serverMessages: T[], localMessages: T[]): T[] {
  const localById = new Map(localMessages.map(message => [message.id, message]))
  const ids = new Set(serverMessages.map(message => message.id))
  const merged = serverMessages.map(message => {
    const local = localById.get(message.id)
    return local ? preferMessage(message, local) : message
  })
  for (const message of localMessages) {
    if (!ids.has(message.id)) merged.push(message)
  }
  return merged.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

/**
 * Same id: merge the two records instead of choosing one wholesale. A later but thinner server
 * snapshot must not erase locally streamed parts, and a synthetic live Tool part must collapse into
 * the snapshot's real one without losing its terminal state.
 */
function preferMessage<T extends StudioMessage | StudioSceneMessage>(server: T, local: T): T {
  const localIsNewer = local.updatedAt > server.updatedAt
  if (server.role !== 'assistant' || local.role !== 'assistant') {
    if (local.updatedAt !== server.updatedAt) {
      return localIsNewer ? local : server
    }
    return messageCompleteness(local) >= messageCompleteness(server) ? local : server
  }

  const base = localIsNewer ? local : server
  const parts = mergeAssistantParts(server.parts, local.parts, localIsNewer, {
    id: server.id,
    sessionId: server.sessionId,
  })
  return { ...base, parts } as unknown as T
}

type AnyStudioPart = StudioMessagePart | StudioScenePart

/**
 * Server parts define the canonical order when it has them; local-only parts are appended in their
 * own order. Overlap is identity, not content: a stable part id, or a Tool callId.
 */
function mergeAssistantParts(
  serverParts: AnyStudioPart[],
  localParts: AnyStudioPart[],
  localIsNewer: boolean,
  scope: { id: string; sessionId: string },
): AnyStudioPart[] {
  const usedLocal = new Set<string>()
  const merged: AnyStudioPart[] = []
  for (const serverPart of serverParts) {
    const localPart = findMatchingPart(serverPart, localParts, usedLocal)
    if (!localPart) {
      merged.push({ ...serverPart, messageId: scope.id, sessionId: scope.sessionId })
      continue
    }
    usedLocal.add(localPart.id)
    merged.push(mergePart(serverPart, localPart, localIsNewer, scope))
  }
  for (const localPart of localParts) {
    if (!usedLocal.has(localPart.id)) {
      merged.push({ ...localPart, messageId: scope.id, sessionId: scope.sessionId })
    }
  }
  return merged
}

function findMatchingPart(
  serverPart: AnyStudioPart,
  localParts: AnyStudioPart[],
  usedLocal: Set<string>,
): AnyStudioPart | undefined {
  const byId = localParts.find(part => !usedLocal.has(part.id) && part.id === serverPart.id)
  if (byId) return byId
  if (serverPart.type !== 'tool') return undefined
  return localParts.find(part =>
    !usedLocal.has(part.id) && part.type === 'tool' && part.callId === serverPart.callId)
}

function mergePart(
  serverPart: AnyStudioPart,
  localPart: AnyStudioPart,
  localIsNewer: boolean,
  scope: { id: string; sessionId: string },
): AnyStudioPart {
  const id = preferRealIdentifier(serverPart.id, localPart.id)
  if (serverPart.type === 'tool' && localPart.type === 'tool') {
    const serverTerminal = isTerminalToolStatus(serverPart.state.status)
    const localTerminal = isTerminalToolStatus(localPart.state.status)
    const state = serverTerminal !== localTerminal
      ? (serverTerminal ? serverPart.state : localPart.state)
      : (localIsNewer ? localPart.state : serverPart.state)
    return {
      ...(localIsNewer ? localPart : serverPart),
      id,
      callId: preferRealIdentifier(serverPart.callId, localPart.callId),
      messageId: scope.id,
      sessionId: scope.sessionId,
      state,
    }
  }

  // Text/reasoning with the same stable id is one part: use the newer full text. Distinct ids are
  // kept as distinct parts even when their content is equal.
  const chosen = localIsNewer ? localPart : serverPart
  return { ...chosen, id, messageId: scope.id, sessionId: scope.sessionId }
}

function isTerminalToolStatus(status: string): boolean {
  return status === 'completed' || status === 'error'
}

/** A live stream part is named `stream:...`; the snapshot's real id wins over that synthetic one. */
function preferRealIdentifier(server: string, local: string): string {
  if (server.startsWith('stream:') && !local.startsWith('stream:')) return local
  return server
}

function messageCompleteness(message: StudioMessage | StudioSceneMessage): number {
  if (message.role !== 'assistant') return message.text.length
  return message.parts.reduce((total, part) =>
    total + (part.type === 'text' || part.type === 'reasoning' ? part.text.length : Object.keys(part.state).length), 0)
}
