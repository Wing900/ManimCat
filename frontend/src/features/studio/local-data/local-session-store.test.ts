import { describe, expect, it } from 'vitest';
import { createMemoryLocalSessionBackend } from './local-session-backend';
import { createLocalStudioSessionStore } from './local-session-store';

/**
 * 本地会话层的行为：身份与顺序由本地持有，追加即顺序，场景源码可覆盖不重复，
 * 以及一次 Run 真正需要的两样东西（对话 + 场景源码）。
 */
function createStore() {
  const backend = createMemoryLocalSessionBackend();
  return { backend, store: createLocalStudioSessionStore(backend) };
}

describe('local studio session store', () => {
  it('mints a local identity and lists it by studio kind', async () => {
    const { store } = createStore();

    const created = await store.create({ studioKind: 'manim', title: 'Manim Studio' });
    await store.create({ studioKind: 'matplotlib', title: 'Plot Studio' });

    expect(created.id.startsWith('sess_local_')).toBe(true);
    expect(created.serverSessionId).toBeNull();
    expect(created.messages).toEqual([]);

    const listed = await store.list('manim');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: created.id, title: 'Manim Studio' });
  });

  it('keeps the transcript in append order and refuses empty or repeated tails', async () => {
    const { store } = createStore();
    const session = await store.create({ studioKind: 'manim', title: 'Manim Studio' });

    await store.recordMessage(session.id, { role: 'user', text: '  画一个圆  ' });
    await store.recordMessage(session.id, { role: 'assistant', text: '好的。' });
    await store.recordMessage(session.id, { role: 'assistant', text: '好的。' });
    await store.recordMessage(session.id, { role: 'user', text: '   ' });

    const record = await store.read(session.id);
    expect(record?.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', '画一个圆'],
      ['assistant', '好的。']
    ]);
  });

  it('updates a scene in place instead of appending a second copy', async () => {
    const { store } = createStore();
    const session = await store.create({ studioKind: 'manim', title: 'Manim Studio' });

    await store.upsertScene(session.id, { id: 'scene_01', source: 'a = 1' });
    await store.upsertScene(session.id, { id: 'scene_02', source: 'b = 2' });
    await store.upsertScene(session.id, { id: 'scene_01', source: 'a = 3', serverSceneId: 'scene_abc' });

    const record = await store.read(session.id);
    expect(record?.scenes).toHaveLength(2);
    expect(record?.scenes[0]).toMatchObject({ id: 'scene_01', source: 'a = 3', serverSceneId: 'scene_abc', position: 0 });
    expect(record?.scenes[1]).toMatchObject({ id: 'scene_02', position: 1 });
  });

  it('hands a Run exactly what it must carry: the conversation and the scene sources', async () => {
    const { store } = createStore();
    const session = await store.create({ studioKind: 'manim', title: 'Manim Studio' });
    await store.recordMessage(session.id, { role: 'user', text: '画一个圆' });
    await store.upsertScene(session.id, { id: 'scene_01', source: 'a = 1' });
    await store.bindServerSession(session.id, 'sess_server_1');

    const bound = await store.read(session.id);
    expect(bound?.serverSessionId).toBe('sess_server_1');

    const context = await store.readRunContext(session.id);
    expect(context).toEqual({
      conversation: [{ role: 'user', text: '画一个圆' }],
      sceneSources: [{ localSceneId: 'scene_01', serverSceneId: null, source: 'a = 1' }]
    });
  });

  it('reads nothing back for a session it does not hold', async () => {
    const { store } = createStore();

    expect(await store.read('sess_local_missing')).toBeNull();
    expect(await store.readRunContext('sess_local_missing')).toBeNull();
    expect(await store.recordMessage('sess_local_missing', { role: 'user', text: 'hi' })).toBeNull();
  });

  it('forgets a removed session', async () => {
    const { store } = createStore();
    const session = await store.create({ studioKind: 'manim', title: 'Manim Studio' });

    await store.remove(session.id);

    expect(await store.read(session.id)).toBeNull();
    expect(await store.list('manim')).toEqual([]);
  });

  it('reports a degraded backend instead of pretending storage survived', async () => {
    const backend = createMemoryLocalSessionBackend();
    const store = createLocalStudioSessionStore(backend, true);
    const session = await store.create({ studioKind: 'manim', title: 'Manim Studio' });

    expect(store.isDegraded()).toBe(true);
    expect(await store.read(session.id)).not.toBeNull();
  });
});
