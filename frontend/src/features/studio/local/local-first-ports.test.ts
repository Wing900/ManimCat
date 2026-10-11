import { describe, expect, it } from 'vitest'
import { StudioApiRequestError } from '../api/client'
import type { StudioServerPort } from '../api/studio-server-port'
import type { StudioEventSubscriptionOptions } from '../api/studio-agent-events'
import type { StudioExternalEvent } from '../protocol/studio-agent-events'
import type {
  StudioCreateSceneRunInput,
  StudioMessage,
  StudioScene,
  StudioSceneMessage,
  StudioSceneRun,
  StudioSession,
} from '../protocol/studio-agent-types'
import { createLocalFirstStudioPorts } from './local-first-ports'
import type { LocalScene, LocalSession, LocalStudioStore } from './local-studio-store'

const STAMP = '2026-01-01T00:00:00.000Z'
const PROJECT_ID = 'manimcat-studio'

function dtoSession(id: string, title = 'Manim Studio'): StudioSession {
  return {
    id,
    projectId: PROJECT_ID,
    studioKind: 'manim',
    agentType: 'builder',
    title,
    directory: `/tmp/${id}`,
    createdAt: STAMP,
    updatedAt: STAMP,
  }
}

function dtoScene(id: string, sessionId: string, position: number): StudioScene {
  return { id, sessionId, position, createdAt: STAMP, updatedAt: STAMP }
}

function dtoSceneRun(id: string, sessionId: string, sceneId: string): StudioSceneRun {
  return { id, sessionId, sceneId, status: 'running', inputText: 'draw', activeAgent: 'builder', createdAt: STAMP }
}

/**
 * The server, as far as these ports can tell: it mints its own ids, it answers snapshots for the Runs
 * it accepted, and `forgetEverything()` is a restart — every id it handed out stops resolving.
 */
function createFakeServer() {
  let sequence = 0
  let sessions = new Map<string, StudioSession>()
  let scenes = new Map<string, StudioScene[]>()
  const runs: Array<{ sessionId: string; sceneId: string; input: StudioCreateSceneRunInput }> = []
  const state = { sessionMessages: [] as StudioMessage[], sceneMessages: [] as StudioSceneMessage[] }

  const mint = (prefix: string) => `${prefix}_${++sequence}`

  const server: StudioServerPort = {
    async createSession(input) {
      const session = dtoSession(mint('sess_srv'), input.title ?? 'Untitled')
      sessions.set(session.id, session)
      scenes.set(session.id, [])
      return session
    },
    async getSessionSnapshot(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) {
        throw new StudioApiRequestError('No such session', 'NOT_FOUND')
      }
      return {
        session,
        messages: state.sessionMessages,
        runs: [],
        renders: [],
        scenes: scenes.get(sessionId) ?? [],
      }
    },
    async deleteSession(sessionId) {
      if (!sessions.delete(sessionId)) {
        throw new StudioApiRequestError('No such session', 'NOT_FOUND')
      }
      scenes.delete(sessionId)
      return true
    },
    async createScene(sessionId) {
      if (!sessions.has(sessionId)) {
        throw new StudioApiRequestError('No such session', 'NOT_FOUND')
      }
      const scene = dtoScene(mint('scene_srv'), sessionId, (scenes.get(sessionId) ?? []).length)
      scenes.set(sessionId, [...(scenes.get(sessionId) ?? []), scene])
      return scene
    },
    async reorderScenes(sessionId, sceneIds) {
      return sceneIds.map((id, position) => ({ ...dtoScene(id, sessionId, position) }))
    },
    async getSceneSnapshot(sessionId, sceneId) {
      const scene = (scenes.get(sessionId) ?? []).find((candidate) => candidate.id === sceneId)
      if (!scene) {
        throw new StudioApiRequestError('No such scene', 'NOT_FOUND')
      }
      return { scene, messages: state.sceneMessages, runs: [], renders: [] }
    },
    async createSceneRun(sessionId, sceneId, input) {
      runs.push({ sessionId, sceneId, input })
      return {
        scene: dtoScene(sceneId, sessionId, 0),
        messages: [],
        runs: [],
        renders: [],
        run: dtoSceneRun(mint('run_srv'), sessionId, sceneId),
      }
    },
    async cancelRun() {
      return { status: 'cancelled' }
    },
  }

  return {
    server,
    runs,
    state,
    /** A server restart: nothing it minted is reachable any more. */
    forgetEverything: () => {
      sessions = new Map()
      scenes = new Map()
    },
  }
}

/**
 * The store's behaviour the ports depend on, in memory. Only the methods they touch are implemented;
 * the IndexedDB side of the store is not exercised here.
 */
function createFakeStore() {
  const sessions = new Map<string, LocalSession>()
  const scenes = new Map<string, LocalScene>()
  const messages: StudioSceneMessage[] = []
  let sequence = 0

  const key = (sessionId: string, sceneId: string) => `${sessionId}/${sceneId}`
  const sortedMessages = (sessionId: string) =>
    messages
      .filter((message) => message.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))

  const store = {
    messages,
    sessions,
    scenes,
    async createSession({ kind, title }: { kind: 'manim' | 'matplotlib'; title: string }) {
      const session: LocalSession = {
        id: `sess_mem_${++sequence}`,
        projectId: 'local',
        studioKind: kind,
        agentType: 'builder',
        title,
        createdAt: STAMP,
        updatedAt: STAMP,
        lastActiveAt: STAMP,
      }
      sessions.set(session.id, session)
      return session
    },
    async getSession(sessionId: string) {
      return sessions.get(sessionId) ?? null
    },
    async listScenes(sessionId: string) {
      return [...scenes.values()]
        .filter((scene) => scene.sessionId === sessionId)
        .sort((left, right) => left.position - right.position)
    },
    async getScene(sessionId: string, sceneId: string) {
      return scenes.get(key(sessionId, sceneId)) ?? null
    },
    /** Mirrors `nextLocalSceneId`: one past the highest number in use, never reused. */
    async createScene(sessionId: string) {
      const existing = [...scenes.values()].filter((scene) => scene.sessionId === sessionId)
      const highest = existing.reduce((slot, scene) => Math.max(slot, Number(scene.id.replace('scene_', ''))), 0)
      const scene: LocalScene = {
        id: `scene_${highest + 1}`,
        sessionId,
        position: existing.length,
        code: '',
        createdAt: STAMP,
        updatedAt: STAMP,
      }
      scenes.set(key(sessionId, scene.id), scene)
      return scene
    },
    async updateSceneCode(sessionId: string, sceneId: string, code: string) {
      const scene = scenes.get(key(sessionId, sceneId))
      if (!scene) {
        throw new Error(`Unknown Scene ${sceneId}`)
      }
      scenes.set(key(sessionId, sceneId), { ...scene, code })
    },
    async reorderScenes(sessionId: string, orderedSceneIds: string[]) {
      orderedSceneIds.forEach((sceneId, position) => {
        const scene = scenes.get(key(sessionId, sceneId))
        if (scene) {
          scenes.set(key(sessionId, sceneId), { ...scene, position })
        }
      })
    },
    async appendMessage(message: StudioSceneMessage) {
      messages.push(message)
    },
    async listMessages(sessionId: string, sceneId: string) {
      return sortedMessages(sessionId).filter((message) => message.sceneId === sceneId)
    },
    async listSessionMessages(sessionId: string) {
      return sortedMessages(sessionId)
    },
    async bindServerSession(sessionId: string, serverSessionId: string) {
      const session = sessions.get(sessionId)
      if (!session) {
        throw new Error(`Unknown Session ${sessionId}`)
      }
      sessions.set(sessionId, { ...session, serverSessionId })
    },
    async bindSceneServerId(sessionId: string, sceneId: string, serverSceneId: string) {
      const scene = scenes.get(key(sessionId, sceneId))
      if (!scene) {
        throw new Error(`Unknown Scene ${sceneId}`)
      }
      scenes.set(key(sessionId, sceneId), { ...scene, serverSceneId })
    },
    async deleteSession(sessionId: string) {
      sessions.delete(sessionId)
      for (const [sceneKey, scene] of [...scenes.entries()]) {
        if (scene.sessionId === sessionId) {
          scenes.delete(sceneKey)
        }
      }
      for (const [index, message] of [...messages.entries()].reverse()) {
        if (message.sessionId === sessionId) {
          messages.splice(index, 1)
        }
      }
    },
  }

  return store as unknown as LocalStudioStore & typeof store
}

function createPorts() {
  const fake = createFakeServer()
  const store = createFakeStore()
  const ports = createLocalFirstStudioPorts({ store, server: fake.server, defaultTitle: 'Studio' })
  return { ...fake, store, ports }
}

describe('the client shape of the Studio ports', () => {
  it('translates the event connection and every frame using the same captured binding', async () => {
    const fake = createFakeServer()
    const store = createFakeStore()
    let subscription: StudioEventSubscriptionOptions | undefined
    const received: StudioExternalEvent[] = []
    const ports = createLocalFirstStudioPorts({ store, server: fake.server,
      subscribeEvents: async options => { subscription = options },
    })
    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID })
    const scene = await ports.sceneApi.createScene(session.id)
    await ports.events.subscribe({ scope: { kind: 'scene', sessionId: session.id, sceneId: scene.id },
      signal: new AbortController().signal, onEvent: event => received.push(event),
    })
    const connection = await subscription!.resolveConnection!()
    expect(connection.scope).toEqual({ kind: 'scene', sessionId: 'sess_srv_1', sceneId: 'scene_srv_2' })
    connection.onEvent({ type: 'run.updated', properties: { sessionId: 'sess_srv_1',
      run: dtoSceneRun('run_1', 'sess_srv_1', 'scene_srv_2'),
    } })
    connection.onEvent({ type: 'assistant.text', properties: { sessionId: 'sess_srv_1',
      sceneId: 'scene_srv_2', runId: 'run_1', messageId: 'msg_1', text: 'done',
    } })
    expect(received).toMatchObject([
      { properties: { sessionId: session.id, run: { sessionId: session.id, sceneId: scene.id } } },
      { properties: { sessionId: session.id, sceneId: scene.id, text: 'done' } },
    ])
    connection.onEvent({ type: 'assistant.text', properties: { sessionId: 'sess_srv_1',
      sceneId: 'another_scene', runId: 'run_2', messageId: 'msg_2', text: 'foreign',
    } })
    expect(received).toHaveLength(2)

    fake.forgetEverything()
    await Promise.all([
      subscription!.onNotFound!(connection.scope), subscription!.onNotFound!(connection.scope),
    ])
    const recovered = await subscription!.resolveConnection!()
    expect(recovered.scope).toEqual({ kind: 'scene', sessionId: 'sess_srv_3', sceneId: 'scene_srv_4' })
    // A delayed 404 for the old binding must reuse the completed restoration.
    await subscription!.onNotFound!(connection.scope)
    expect((await subscription!.resolveConnection!()).scope).toEqual(recovered.scope)
  })

  it('keeps the identity the browser owns while the server mints its own', async () => {
    const { ports, store } = createPorts()

    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID, title: 'Manim Studio' })
    const scene = await ports.sceneApi.createScene(session.id)

    // The UI sees only local ids: stable across a server restart, and the Scene id is a Python stem.
    expect(session.id).toBe('sess_mem_1')
    expect(scene.id).toBe('scene_1')
    expect(scene.sessionId).toBe('sess_mem_1')

    // The bindings are what connect the two identities.
    expect((await store.getSession('sess_mem_1'))?.serverSessionId).toBe('sess_srv_1')
    expect((await store.getScene('sess_mem_1', 'scene_1'))?.serverSceneId).toBe('scene_srv_2')
  })

  it('rebuilds a Session the server forgot and retries once with the new ids', async () => {
    const { ports, store, forgetEverything } = createPorts()

    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID, title: 'Manim Studio' })
    const scene = await ports.sceneApi.createScene(session.id)
    await ports.sceneApi.createSceneRun(session.id, scene.id, { inputText: 'draw a circle' })
    await store.appendMessage({
      id: 'msg_local_1',
      sessionId: session.id,
      sceneId: scene.id,
      role: 'user',
      text: 'earlier',
      createdAt: STAMP,
      updatedAt: STAMP,
    })

    forgetEverything()

    const snapshot = await ports.sceneApi.getSceneSnapshot('sess_mem_1', 'scene_1')

    // The same local identity, a fresh server identity, and the transcript the browser kept.
    expect(snapshot.scene.id).toBe('scene_1')
    expect((await store.getSession('sess_mem_1'))?.serverSessionId).toBe('sess_srv_4')
    expect((await store.getScene('sess_mem_1', 'scene_1'))?.serverSceneId).toBe('scene_srv_5')
    // The transcript the browser kept, including the message of the Run it submitted earlier.
    expect(snapshot.messages.map((message) => (message.role === 'user' ? message.text : ''))).toEqual([
      'earlier',
      'draw a circle',
    ])

    // The retry used the new binding rather than the dead one.
    const nextRun = await ports.sceneApi.createSceneRun('sess_mem_1', 'scene_1', { inputText: 'again' })
    expect(nextRun.run.sessionId).toBe('sess_mem_1')
  })

  it('translates the sources it holds into the ids the server knows', async () => {
    const { ports, store, runs } = createPorts()

    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID, title: 'Manim Studio' })
    const first = await ports.sceneApi.createScene(session.id)
    const second = await ports.sceneApi.createScene(session.id)

    await ports.sceneApi.createSceneRun(session.id, second.id, {
      inputText: 'draw',
      code: { [first.id]: 'print(1)', [second.id]: 'from scene_1 import *' },
    })

    const run = runs.at(-1)
    expect(run?.sceneId).toBe('scene_srv_3')
    // Keys are the server's Scene ids: the server materializes files named after them.
    expect(run?.input.code).toEqual({ scene_srv_2: 'print(1)', scene_srv_3: 'from scene_1 import *' })
    // The code it sent is the durable copy from then on.
    expect((await store.getScene('sess_mem_1', 'scene_1'))?.code).toBe('print(1)')
  })

  it('replays the transcript this browser owns', async () => {
    const { ports, store, runs } = createPorts()

    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID, title: 'Manim Studio' })
    const scene = await ports.sceneApi.createScene(session.id)
    await store.appendMessage({
      id: 'msg_local_1',
      sessionId: session.id,
      sceneId: scene.id,
      role: 'user',
      text: 'what did we do',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await store.appendMessage({
      id: 'msg_local_2',
      sessionId: session.id,
      sceneId: scene.id,
      role: 'assistant',
      agent: 'builder',
      parts: [
        { id: 'msg_local_2_text', messageId: 'msg_local_2', sessionId: session.id, type: 'text', text: 'a circle' },
      ],
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    })

    await ports.sceneApi.createSceneRun(session.id, scene.id, { inputText: 'and now' })

    expect(runs.at(-1)?.input.conversation).toEqual([
      { role: 'user', text: 'what did we do' },
      { role: 'assistant', text: 'a circle' },
    ])
    // The submitted message is part of the local transcript too.
    const recorded = await store.listSessionMessages(session.id)
    expect(recorded.at(-1)).toMatchObject({ role: 'user', text: 'and now', sceneId: 'scene_1' })
    // Written strictly after the transcript it follows, so a replay cannot reorder it.
    expect(recorded.at(-1)!.createdAt > recorded.at(-2)!.createdAt).toBe(true)
  })

  it('absorbs a reply the server already knows, exactly once', async () => {
    const { ports, store, state } = createPorts()

    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID, title: 'Manim Studio' })
    const scene = await ports.sceneApi.createScene(session.id)
    state.sceneMessages = [
      {
        id: 'msg_srv_1',
        sessionId: 'sess_srv_1',
        sceneId: 'scene_srv_2',
        role: 'assistant',
        agent: 'builder',
        parts: [
          { id: 'part_1', messageId: 'msg_srv_1', sessionId: 'sess_srv_1', type: 'text', text: 'done' },
        ],
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ]

    const first = await ports.sceneApi.getSceneSnapshot(session.id, scene.id)
    const second = await ports.sceneApi.getSceneSnapshot(session.id, scene.id)

    // Server ids are translated on the way in, and the reply lands in the local transcript once.
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0]).toMatchObject({ sceneId: 'scene_1', sessionId: 'sess_mem_1' })
    expect(second.messages).toHaveLength(1)
    const local = await store.listSessionMessages(session.id)
    expect(local.filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(local[0]).toMatchObject({ sceneId: 'scene_1', sessionId: 'sess_mem_1' })
  })

  it('deletes locally even when the server no longer has the Session', async () => {
    const { ports, store, forgetEverything } = createPorts()

    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID, title: 'Manim Studio' })
    await ports.sceneApi.createScene(session.id)
    forgetEverything()

    await expect(ports.sessionApi.deleteSession(session.id)).resolves.toBe(true)
    expect(await store.getSession(session.id)).toBeNull()
  })
})
