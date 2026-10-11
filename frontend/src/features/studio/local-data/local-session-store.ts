import { createDefaultLocalSessionBackend, type LocalSessionBackend } from './local-session-backend';
import type {
  LocalStudioMessage,
  LocalStudioRunContext,
  LocalStudioScene,
  LocalStudioSessionRecord,
  LocalStudioSessionSummary
} from './local-session-record';

export interface LocalStudioSessionStore {
  /** 会话列表（最近更新在前），本地身份 + 标题 + 更新时间。 */
  list: (studioKind: string) => Promise<LocalStudioSessionSummary[]>;
  read: (sessionId: string) => Promise<LocalStudioSessionRecord | null>;
  create: (input: { studioKind: string; title: string; projectId?: string }) => Promise<LocalStudioSessionRecord>;
  save: (record: LocalStudioSessionRecord) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  /** 记下这次会话当前绑定的服务端 Session（重启后由本地重新创建一个并重新绑定）。 */
  bindServerSession: (sessionId: string, serverSessionId: string | null) => Promise<LocalStudioSessionRecord | null>;
  /** 把浏览器看到的一条消息记进本地正文。空文本不记；与末条完全相同的重复不记。 */
  recordMessage: (
    sessionId: string,
    message: { role: LocalStudioMessage['role']; text: string; sceneId?: string }
  ) => Promise<LocalStudioSessionRecord | null>;
  /**
   * 同上去重，但比的是**整段正文**而不只是末条：这一条用于「从读取中吸收服务端已知的消息」，
   * 同一条回复可能被读到多次，中间可能又插入了用户的新输入。
   */
  recordMessageOnce: (
    sessionId: string,
    message: { role: LocalStudioMessage['role']; text: string; sceneId?: string }
  ) => Promise<LocalStudioSessionRecord | null>;
  /** 落地一个场景的源码（浏览器持有代码）。同一本地 id 覆盖，不新增。 */
  upsertScene: (
    sessionId: string,
    scene: { id: string; source: string; serverSceneId?: string | null }
  ) => Promise<LocalStudioSessionRecord | null>;
  /** 一次 Run 需要的上下文：被给定的对话 + 这份会话当前的场景源码。 */
  readRunContext: (sessionId: string) => Promise<LocalStudioRunContext | null>;
  /** 存储不可用时的降级状态：会话只在本次页面存活内有效。 */
  isDegraded: () => boolean;
}

/**
 * 会话在本地的那一层。所有操作都是「读一条、改一条、写回」：会话数量小，语义比吞吐重要。
 * 顺序由数组显式承载（追加即顺序），不靠时间戳比较 —— 同一毫秒里发生的两条消息永远排在后面。
 */
export function createLocalStudioSessionStore(backend: LocalSessionBackend, degraded = false): LocalStudioSessionStore {
  async function read(sessionId: string): Promise<LocalStudioSessionRecord | null> {
    const records = await backend.readAll();
    return records.find((record) => record.id === sessionId) ?? null;
  }

  async function mutate(
    sessionId: string,
    change: (record: LocalStudioSessionRecord) => LocalStudioSessionRecord
  ): Promise<LocalStudioSessionRecord | null> {
    const record = await read(sessionId);
    if (!record) {
      return null;
    }
    const updated = { ...change(record), updatedAt: nowIso() };
    await backend.write(updated);
    return updated;
  }

  return {
    list: async (studioKind) => {
      const records = await backend.readAll();
      return records
        .filter((record) => record.studioKind === studioKind)
        .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
        .map((record) => ({ id: record.id, title: record.title, updatedAt: record.updatedAt }));
    },

    read,

    create: async (input) => {
      const timestamp = nowIso();
      const record: LocalStudioSessionRecord = {
        id: `sess_local_${crypto.randomUUID()}`,
        studioKind: input.studioKind,
        title: input.title,
        projectId: input.projectId ?? 'manimcat-studio',
        createdAt: timestamp,
        updatedAt: timestamp,
        serverSessionId: null,
        scenes: [],
        messages: []
      };
      await backend.write(record);
      return record;
    },

    save: async (record) => {
      await backend.write({ ...record, updatedAt: nowIso() });
    },

    remove: async (sessionId) => {
      await backend.remove(sessionId);
    },

    bindServerSession: (sessionId, serverSessionId) =>
      mutate(sessionId, (record) => ({ ...record, serverSessionId })),

    recordMessage: (sessionId, message) =>
      mutate(sessionId, (record) => {
        const text = message.text.trim();
        if (!text) {
          return record;
        }

        const last = record.messages[record.messages.length - 1];
        if (last && last.role === message.role && last.text === text) {
          return record;
        }

        return appendMessage(record, { ...message, text });
      }),

    recordMessageOnce: (sessionId, message) =>
      mutate(sessionId, (record) => {
        const text = message.text.trim();
        if (!text) {
          return record;
        }

        const alreadyKnown = record.messages.some(
          (candidate) => candidate.role === message.role && candidate.text === text
        );
        if (alreadyKnown) {
          return record;
        }

        return appendMessage(record, { ...message, text });
      }),

    upsertScene: (sessionId, scene) =>
      mutate(sessionId, (record) => {
        const existing = record.scenes.find((candidate) => candidate.id === scene.id);
        const next: LocalStudioScene = {
          id: scene.id,
          serverSceneId: scene.serverSceneId ?? existing?.serverSceneId ?? null,
          position: existing?.position ?? record.scenes.length,
          source: scene.source,
          updatedAt: nowIso()
        };

        return {
          ...record,
          scenes: existing
            ? record.scenes.map((candidate) => (candidate.id === scene.id ? next : candidate))
            : [...record.scenes, next]
        };
      }),

    readRunContext: async (sessionId) => {
      const record = await read(sessionId);
      if (!record) {
        return null;
      }

      return {
        conversation: record.messages.map((message) => ({ role: message.role, text: message.text })),
        sceneSources: record.scenes.map((scene) => ({
          localSceneId: scene.id,
          serverSceneId: scene.serverSceneId,
          source: scene.source
        }))
      };
    },

    isDegraded: () => degraded
  };
}

/** 默认那一份：浏览器能存就存 IndexedDB，不能就退到内存。 */
export function createDefaultLocalStudioSessionStore(): LocalStudioSessionStore {
  const { backend, degraded } = createDefaultLocalSessionBackend();
  return createLocalStudioSessionStore(backend, degraded);
}

function nowIso(): string {
  return new Date().toISOString();
}

function appendMessage(
  record: LocalStudioSessionRecord,
  message: { role: LocalStudioMessage['role']; text: string; sceneId?: string }
): LocalStudioSessionRecord {
  return {
    ...record,
    messages: [
      ...record.messages,
      {
        id: `msg_local_${crypto.randomUUID()}`,
        role: message.role,
        text: message.text,
        createdAt: nowIso(),
        ...(message.sceneId ? { sceneId: message.sceneId } : {})
      }
    ]
  };
}
