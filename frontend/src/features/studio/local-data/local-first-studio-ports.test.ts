import { describe, expect, it } from 'vitest';
import { StudioApiRequestError } from '../api/client';
import type {
  StudioMessage,
  StudioScene,
  StudioSceneSnapshot,
  StudioSession,
  StudioSessionSnapshot
} from '../protocol/studio-agent-types';
import { createMemoryLocalSessionBackend } from './local-session-backend';
import { createLocalStudioSessionStore } from './local-session-store';
import { createLocalFirstStudioPorts, type LocalFirstServerPort } from './local-first-studio-ports';

/**
 * 端口的三条承重行为：
 *  1. Run 的 `code` 键与路径都翻译成服务端 id（否则 agent 读不到刚写下的源码）；
 *  2. 服务端说没有（重启过）→ 本地重建会话与场景，然后把同一次操作重试一遍；
 *  3. 快照对 UI 露出的是**本地身份**与**本地正文**。
 */

function dtoSession(id: string, title = 'Manim Studio'): StudioSession {
  const stamp = new Date().toISOString();
  return {
    id,
    projectId: 'manimcat-studio',
    agentType: 'builder',
    title,
    directory: '/tmp/studio',
    studioKind: 'manim',
    createdAt: stamp,
    updatedAt: stamp
  };
}

function dtoScene(id: string, sessionId: string, position: number): StudioScene {
  const stamp = new Date().toISOString();
  return { id, sessionId, position, createdAt: stamp, updatedAt: stamp };
}

function createFakeServer() {
  const calls = { createSession: 0, createScene: 0, runs: [] as Array<{ sessionId: string; sceneId: string; input: Record<string, unknown> }> };
  const state = { forgotten: false, sessionMessages: [] as StudioMessage[] };
  let sessionId = '';
  let sceneIds: string[] = [];

  function assertAlive() {
    if (state.forgotten) {
      throw new StudioApiRequestError('Run or session not found', 'NOT_FOUND');
    }
  }

  const server: LocalFirstServerPort = {
    createSession: async (input) => {
      calls.createSession += 1;
      sessionId = `sess_srv_${calls.createSession}`;
      sceneIds = [];
      state.forgotten = false;
      return dtoSession(sessionId, input.title ?? 'Manim Studio');
    },
    createScene: async (targetSessionId) => {
      calls.createScene += 1;
      const id = `scene_srv_${calls.createScene}`;
      sceneIds.push(id);
      assertAlive();
      return dtoScene(id, targetSessionId, sceneIds.length - 1);
    },
    getSessionSnapshot: async (targetSessionId): Promise<StudioSessionSnapshot> => {
      assertAlive();
      return {
        session: dtoSession(targetSessionId),
        messages: state.sessionMessages,
        runs: [],
        renders: [],
        scenes: sceneIds.map((id, index) => dtoScene(id, targetSessionId, index))
      };
    },
    getSceneSnapshot: async (targetSessionId, sceneId): Promise<StudioSceneSnapshot> => {
      assertAlive();
      return { scene: dtoScene(sceneId, targetSessionId, 0), messages: [], runs: [], renders: [] };
    },
    createSceneRun: async (targetSessionId, sceneId, input) => {
      assertAlive();
      calls.runs.push({ sessionId: targetSessionId, sceneId, input: input as unknown as Record<string, unknown> });
      return { scene: dtoScene(sceneId, targetSessionId, 0), messages: [], runs: [], renders: [], run: { id: 'run_1' } } as never;
    },
    reorderScenes: async (targetSessionId, ids) => ids.map((id, index) => dtoScene(id, targetSessionId, index)),
    deleteSession: async (targetSessionId) => {
      assertAlive();
      return targetSessionId === sessionId;
    },
    cancelRun: async () => ({ status: 'cancelled' })
  };

  return {
    server,
    calls,
    setSessionMessages: (messages: StudioMessage[]) => {
      state.sessionMessages = messages;
    },
    forget: () => {
      state.forgotten = true;
    }
  };
}

function createPorts() {
  const store = createLocalStudioSessionStore(createMemoryLocalSessionBackend());
  const fake = createFakeServer();
  const ports = createLocalFirstStudioPorts({
    store,
    server: fake.server,
    defaultTitle: 'Manim Studio',
    projectId: 'manimcat-studio'
  });
  return { store, ...fake, ports };
}

describe('local-first studio ports', () => {
  it('translates the Run sources into server Scene ids, which is what the workspace is written from', async () => {
    const { store, calls, ports } = createPorts();

    const session = await ports.sessionApi.createSession({ projectId: 'manimcat-studio' });
    const scene = await ports.sceneApi.createScene(session.id);
    await store.upsertScene(session.id, { id: scene.id, source: 'print(1)' });

    await ports.sceneApi.createSceneRun(session.id, scene.id, {
      inputText: '画一个圆',
      code: { [scene.id]: 'print(1)' }
    });

    expect(calls.runs).toHaveLength(1);
    expect(calls.runs[0].sceneId).toBe('scene_srv_1');
    // 键是服务端场景 id，不是本地那个：否则 materialize 写下的文件名与 Scene 记录对不上。
    expect(Object.keys(calls.runs[0].input.code as Record<string, string>)).toEqual(['scene_srv_1']);
    expect(calls.runs[0].input.conversation).toBeUndefined();

    // 用户这一次输入进入本地正文，下一次 Run 才有上下文可交出去。
    const record = await store.read(session.id);
    expect(record?.messages.map((message) => message.text)).toEqual(['画一个圆']);
  });

  it('re-creates the server session and scenes after the server forgot them, then retries', async () => {
    const { store, calls, forget, ports } = createPorts();

    const session = await ports.sessionApi.createSession({ projectId: 'manimcat-studio' });
    const scene = await ports.sceneApi.createScene(session.id);
    await store.upsertScene(session.id, { id: scene.id, source: 'print(1)' });
    await store.recordMessage(session.id, { role: 'user', text: '之前说过的话', sceneId: scene.id });

    forget();

    await ports.sceneApi.createSceneRun(session.id, scene.id, { inputText: '接着来' });

    expect(calls.createSession).toBe(2);
    expect(calls.createScene).toBe(2);
    // 重试用的是**新**场景 id，而 UI 手里的本地身份没有变。
    expect(calls.runs[0].sessionId).toBe('sess_srv_2');
    expect(calls.runs[0].sceneId).toBe('scene_srv_2');
    expect(calls.runs[0].input.conversation).toEqual([{ role: 'user', text: '之前说过的话' }]);

    const record = await store.read(session.id);
    expect(record?.serverSessionId).toBe('sess_srv_2');
    expect(record?.scenes[0].serverSceneId).toBe('scene_srv_2');
  });

  it('shows the local identity and the local transcript in the snapshot', async () => {
    const { store, ports } = createPorts();

    const session = await ports.sessionApi.createSession({ projectId: 'manimcat-studio' });
    const scene = await ports.sceneApi.createScene(session.id);
    await store.recordMessage(session.id, { role: 'user', text: '我说过一句', sceneId: scene.id });

    const snapshot = await ports.sessionApi.getSessionSnapshot(session.id);
    expect(snapshot.session.id).toBe(session.id);
    expect(snapshot.messages.map((message) => message.role)).toEqual(['user']);
    expect(snapshot.scenes?.[0].id).toBe(scene.id);

    const sceneSnapshot = await ports.sceneApi.getSceneSnapshot(session.id, scene.id);
    expect(sceneSnapshot.scene.id).toBe(scene.id);
    expect(sceneSnapshot.scene.sessionId).toBe(session.id);
  });

  it('absorbs the assistant reply it can see, exactly once', async () => {
    const { store, setSessionMessages, ports } = createPorts();

    const session = await ports.sessionApi.createSession({ projectId: 'manimcat-studio' });
    const stamp = new Date().toISOString();
    setSessionMessages([
      {
        id: 'msg_srv_1',
        sessionId: 'sess_srv_1',
        role: 'assistant',
        agent: 'builder',
        parts: [{ id: 'part_1', messageId: 'msg_srv_1', sessionId: 'sess_srv_1', type: 'text', text: '好的。' }],
        createdAt: stamp,
        updatedAt: stamp
      }
    ]);

    await ports.sessionApi.getSessionSnapshot(session.id);
    await ports.sessionApi.getSessionSnapshot(session.id);

    const record = await store.read(session.id);
    expect(record?.messages.map((message) => [message.role, message.text])).toEqual([['assistant', '好的。']]);
  });

  it('deletes locally even when the server no longer has the session', async () => {
    const { forget, ports } = createPorts();

    const session = await ports.sessionApi.createSession({ projectId: 'manimcat-studio' });
    forget();

    await expect(ports.sessionApi.deleteSession(session.id)).resolves.toBe(true);
    await expect(ports.sessionApi.getSessionSnapshot(session.id)).rejects.toThrow();
  });
});
