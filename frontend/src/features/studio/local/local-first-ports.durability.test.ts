import { describe, expect, it } from 'vitest'
import { StudioApiRequestError } from '../api/client'
import type { StudioServerPort } from '../api/studio-server-port'
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
  return {
    id,
    sessionId,
    sceneId,
    status: 'running',
    inputText: 'draw',
    activeAgent: 'builder',
    createdAt: STAMP,
  }
}

function createFakeServer() {
  let sequence = 0
  let sessions = new Map<string, StudioSession>()
  let scenes = new Map<string, StudioScene[]>()
  const state = {
    sessionMessages: [] as StudioMessage[],
    sceneMessages: [] as StudioSceneMessage[],
    fail: false,
  }
  const runs: Array<{ sessionId: string; sceneId: string; input: StudioCreateSceneRunInput }> = []
  const mint = (prefix: string) => `${prefix}_${++sequence}`

  const server: StudioServerPort = {
    async createSession(input) {
      if (state.fail) throw new Error('offline')
      const session = dtoSession(mint('sess_srv'), input.title ?? 'Untitled')
      sessions.set(session.id, session)
      scenes.set(session.id, [])
      return session
    },
    async getSessionSnapshot(sessionId) {
      if (state.fail) throw new Error('offline')
      const session = sessions.get(sessionId)
      if (!session) throw new StudioApiRequestError('No such session', 'NOT_FOUND')
      return {
        session,
        messages: state.sessionMessages,
        runs: [],
        renders: [],
        scenes: scenes.get(sessionId) ?? [],
      }
    },
    async deleteSession(sessionId) {
      sessions.delete(sessionId)
      scenes.delete(sessionId)
      return true
    },
    async createScene(sessionId) {
      if (state.fail) throw new Error('offline')
      if (!sessions.has(sessionId)) throw new StudioApiRequestError('No such session', 'NOT_FOUND')
      const scene = dtoScene(mint('scene_srv'), sessionId, (scenes.get(sessionId) ?? []).length)
      scenes.set(sessionId, [...(scenes.get(sessionId) ?? []), scene])
      return scene
    },
    async reorderScenes(sessionId, sceneIds) {
      return sceneIds.map((id, position) => dtoScene(id, sessionId, position))
    },
    async getSceneSnapshot(sessionId, sceneId) {
      if (state.fail) throw new Error('offline')
      const scene = (scenes.get(sessionId) ?? []).find((candidate) => candidate.id === sceneId)
      if (!scene) throw new StudioApiRequestError('No such scene', 'NOT_FOUND')
      return { scene, messages: state.sceneMessages, runs: [], renders: [] }
    },
    async createSceneRun(sessionId, sceneId, input) {
      if (state.fail) throw new Error('offline')
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
    forgetEverything: () => {
      sessions = new Map()
      scenes = new Map()
    },
  }
}

function createFakeStore() {
  const sessions = new Map<string, LocalSession>()
  const scenes = new Map<string, LocalScene>()
  const messages: StudioSceneMessage[] = []
  let sequence = 0
  const key = (sessionId: string, sceneId: string) => `${sessionId}/${sceneId}`
  const ordered = (sessionId: string) => messages
    .filter((message) => message.sessionId === sessionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))

  const store = {
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
      if (!scene) throw new Error(`Unknown Scene ${sceneId}`)
      scenes.set(key(sessionId, sceneId), { ...scene, code })
    },
    async reorderScenes(sessionId: string, orderedSceneIds: string[]) {
      orderedSceneIds.forEach((sceneId, position) => {
        const scene = scenes.get(key(sessionId, sceneId))
        if (scene) scenes.set(key(sessionId, sceneId), { ...scene, position })
      })
    },
    async appendMessage(message: StudioSceneMessage) {
      const index = messages.findIndex((candidate) => candidate.id === message.id)
      if (index < 0) messages.push(message)
      else messages[index] = message
    },
    async listMessages(sessionId: string, sceneId: string) {
      return ordered(sessionId).filter((message) => message.sceneId === sceneId)
    },
    async listSessionMessages(sessionId: string) {
      return ordered(sessionId)
    },
    async bindServerSession(sessionId: string, serverSessionId: string) {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`Unknown Session ${sessionId}`)
      sessions.set(sessionId, { ...session, serverSessionId })
    },
    async bindSceneServerId(sessionId: string, sceneId: string, serverSceneId: string) {
      const scene = scenes.get(key(sessionId, sceneId))
      if (!scene) throw new Error(`Unknown Scene ${sceneId}`)
      scenes.set(key(sessionId, sceneId), { ...scene, serverSceneId })
    },
    async deleteSession(sessionId: string) {
      sessions.delete(sessionId)
      for (const [sceneKey, scene] of [...scenes.entries()]) {
        if (scene.sessionId === sessionId) scenes.delete(sceneKey)
      }
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.sessionId === sessionId) messages.splice(index, 1)
      }
    },
  }

  return store as unknown as LocalStudioStore & typeof store
}

function localMessage(input: {
  id: string
  text?: string
  role: 'user' | 'assistant'
  sceneId: string
  sessionId: string
  second: number
}): StudioSceneMessage {
  const timestamp = `2026-01-01T00:00:0${input.second}.000Z`
  if (input.role === 'user') {
    return {
      id: input.id,
      sessionId: input.sessionId,
      sceneId: input.sceneId,
      role: 'user',
      text: input.text ?? input.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }
  return {
    id: input.id,
    sessionId: input.sessionId,
    sceneId: input.sceneId,
    role: 'assistant',
    agent: 'builder',
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function partOrder(message: StudioSceneMessage | undefined): string[] {
  if (!message || message.role !== 'assistant') return []
  return message.parts.map((part) => part.type === 'text'
    ? `text:${part.text}`
    : part.type === 'tool' ? `tool:${part.tool}` : `reasoning:${part.text}`)
}

describe('browser durable history', () => {
  it('keeps A B C D, repeated text and tool/text order across an empty remote snapshot and a rebind', async () => {
    const fake = createFakeServer()
    const store = createFakeStore()
    const ports = createLocalFirstStudioPorts({ store, server: fake.server })
    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID })
    const scene = await ports.sceneApi.createScene(session.id)

    const assistant = localMessage({
      id: 'B', role: 'assistant', sessionId: session.id, sceneId: scene.id, second: 1,
    })
    if (assistant.role === 'assistant') {
      assistant.parts = [
        { id: 'part_text_a', messageId: 'B', sessionId: session.id, type: 'text', text: 'textA' },
        {
          id: 'part_tool_a', messageId: 'B', sessionId: session.id, type: 'tool', tool: 'ToolA', callId: 'call_a',
          state: { status: 'completed', title: 'ToolA' },
        },
        { id: 'part_text_b', messageId: 'B', sessionId: session.id, type: 'text', text: 'textB' },
        {
          id: 'part_tool_b', messageId: 'B', sessionId: session.id, type: 'tool', tool: 'ToolB', callId: 'call_b',
          state: { status: 'completed', title: 'ToolB' },
        },
      ]
    }
    for (const message of [
      localMessage({ id: 'A', role: 'user', sessionId: session.id, sceneId: scene.id, second: 0 }),
      assistant,
      localMessage({ id: 'C', role: 'user', text: 'same words', sessionId: session.id, sceneId: scene.id, second: 2 }),
      localMessage({ id: 'D', role: 'user', text: 'same words', sessionId: session.id, sceneId: scene.id, second: 3 }),
    ]) {
      await store.appendMessage(message)
    }

    const first = await ports.sceneApi.getSceneSnapshot(session.id, scene.id)
    expect(first.serverBindingId).toBeDefined()
    expect(first.scene.id).toBe('scene_1')
    expect(first.scene.sessionId).toBe('sess_mem_1')
    expect(first.messages.map((message) => message.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(first.messages.filter((message) => message.role === 'user' && message.text === 'same words'))
      .toHaveLength(2)
    expect(partOrder(first.messages.find((message) => message.id === 'B')))
      .toEqual(['text:textA', 'tool:ToolA', 'text:textB', 'tool:ToolB'])

    const sessionSnapshot = await ports.sessionApi.getSessionSnapshot(session.id)
    expect(sessionSnapshot.scenes?.map((candidate) => candidate.id)).toEqual(['scene_1'])
    expect(sessionSnapshot.messages.map((message) => message.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(sessionSnapshot.messages.every((message) => message.sessionId === 'sess_mem_1')).toBe(true)

    // The backend forgot every id it minted; the browser identity and history must not move.
    fake.forgetEverything()
    const rebound = await ports.sceneApi.getSceneSnapshot(session.id, scene.id)
    expect(rebound.scene.id).toBe('scene_1')
    expect(rebound.serverBindingId).not.toBe(first.serverBindingId)
    expect(rebound.messages.map((message) => message.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(partOrder(rebound.messages.find((message) => message.id === 'B')))
      .toEqual(['text:textA', 'tool:ToolA', 'text:textB', 'tool:ToolB'])

    // A re-open after another read returns the same order, not a re-sorted or deduplicated view.
    const reopened = await ports.sceneApi.getSceneSnapshot(session.id, scene.id)
    expect(reopened.messages.map((message) => message.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(partOrder(reopened.messages.find((message) => message.id === 'B')))
      .toEqual(['text:textA', 'tool:ToolA', 'text:textB', 'tool:ToolB'])
  })

  it('replays only the selected Scene transcript to a Scene Run', async () => {
    const fake = createFakeServer()
    const store = createFakeStore()
    const ports = createLocalFirstStudioPorts({ store, server: fake.server })
    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID })
    const first = await ports.sceneApi.createScene(session.id)
    const second = await ports.sceneApi.createScene(session.id)
    await store.appendMessage(localMessage({
      id: 'first_ask', role: 'user', text: 'first scene ask', sessionId: session.id, sceneId: first.id, second: 0,
    }))
    await store.appendMessage(localMessage({
      id: 'second_ask', role: 'user', text: 'sibling scene ask', sessionId: session.id, sceneId: second.id, second: 1,
    }))

    await ports.sceneApi.createSceneRun(session.id, first.id, { inputText: 'continue first' })

    expect(fake.runs.at(-1)?.sceneId).toBe('scene_srv_2')
    expect(fake.runs.at(-1)?.input.conversation).toEqual([
      { role: 'user', text: 'first scene ask' },
    ])
  })

  it('restores a local Session without waiting for a hanging remote snapshot', async () => {
    const fake = createFakeServer()
    const store = createFakeStore()
    const ports = createLocalFirstStudioPorts({ store, server: fake.server })
    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID })
    const scene = await ports.sceneApi.createScene(session.id)
    await store.appendMessage(localMessage({
      id: 'local_only', role: 'user', text: 'kept locally', sessionId: session.id, sceneId: scene.id, second: 0,
    }))

    let remoteSnapshotCalls = 0
    const neverResolves = new Promise<never>(() => {})
    fake.server.getSessionSnapshot = async () => {
      remoteSnapshotCalls += 1
      return neverResolves
    }

    // The sentinel settles only after the local restore has had plenty of microtask turns. No timer
    // is involved: if the public Session API awaited the hanging remote call, the sentinel wins.
    let resolveSentinel!: () => void
    const sentinel = new Promise<'sentinel'>((resolve) => {
      resolveSentinel = () => resolve('sentinel')
    })
    void (async () => {
      for (let index = 0; index < 100; index += 1) await Promise.resolve()
      resolveSentinel()
    })()

    const outcome = await Promise.race([
      ports.sessionApi.getSessionSnapshot(session.id).then((snapshot) => ({ source: 'local' as const, snapshot })),
      sentinel.then(() => ({ source: 'sentinel' as const, snapshot: null })),
    ])

    expect(outcome.source).toBe('local')
    if (outcome.source !== 'local') throw new Error('Local Session restore waited for the remote snapshot')
    expect(outcome.snapshot.session.id).toBe('sess_mem_1')
    expect(outcome.snapshot.scenes?.map((candidate) => candidate.id)).toEqual(['scene_1'])
    expect(outcome.snapshot.messages.map((message) => message.id)).toEqual(['local_only'])
    expect(remoteSnapshotCalls).toBe(0)
  })

  it('returns the local history when the server is offline', async () => {
    const fake = createFakeServer()
    const store = createFakeStore()
    const ports = createLocalFirstStudioPorts({ store, server: fake.server })
    const session = await ports.sessionApi.createSession({ projectId: PROJECT_ID })
    const scene = await ports.sceneApi.createScene(session.id)
    await store.appendMessage(localMessage({
      id: 'offline_local', role: 'user', text: 'kept', sessionId: session.id, sceneId: scene.id, second: 0,
    }))

    fake.state.fail = true

    const localSession = await ports.sessionApi.getSessionSnapshot(session.id)
    expect(localSession.session.id).toBe('sess_mem_1')
    expect(localSession.scenes?.map((candidate) => candidate.id)).toEqual(['scene_1'])
    expect(localSession.messages.map((message) => message.id)).toEqual(['offline_local'])
    expect(localSession.runs).toEqual([])

    const localScene = await ports.sceneApi.getSceneSnapshot(session.id, scene.id)
    expect(localScene.scene.id).toBe('scene_1')
    expect(localScene.serverBindingId).toBeUndefined()
    expect(localScene.messages.map((message) => message.id)).toEqual(['offline_local'])
  })
})
