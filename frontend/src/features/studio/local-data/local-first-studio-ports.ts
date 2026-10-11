import { StudioApiRequestError } from '../api/client';
import type { StudioRequestOptions } from '../api/studio-agent-api';
import type { StudioCinemaApiPort, StudioCinemaCancelResponse } from '../cinema/cinema-controller';
import type { StudioCinemaSessionGatewayApi } from '../cinema/session/studio-cinema-session-gateway';
import type {
  StudioAgentType,
  StudioCreateSceneRunInput,
  StudioCreateSceneRunResponse,
  StudioCreateSessionInput,
  StudioMessage,
  StudioScene,
  StudioSceneMessage,
  StudioSceneSnapshot,
  StudioSession,
  StudioSessionSnapshot
} from '../protocol/studio-agent-types';
import type { LocalStudioSessionRecord } from './local-session-record';
import type { LocalStudioSessionStore } from './local-session-store';

/**
 * `STUDIO_DATA_MODE=client` 形态下的两个端口：**会话身份由浏览器持有，执行仍在服务端**。
 *
 * 这一层之所以存在，是因为两种身份必须翻译：UI 只知道本地 id（跨服务端重启稳定），服务端只知道它
 * 自己铸的 id（随进程消失）。翻译不是可选的美化 —— 服务端在 Run 前会用 Scene 记录里的 sourcePath
 * 校验文件，所以 `code` 的键与 Run 路径都必须换成服务端 id，否则 agent 读不到自己刚被写下的源码。
 *
 * 自愈策略是「先乐观、遇 404 再重建」：正常路径一次请求都不多花；服务端重启后第一次调用会
 * 在本地重建会话与场景并重新绑定，然后重试同一次操作。
 */
export interface LocalFirstServerPort {
  createSession: (input: StudioCreateSessionInput) => Promise<StudioSession>;
  getSessionSnapshot: (sessionId: string, options?: StudioRequestOptions) => Promise<StudioSessionSnapshot>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  createScene: (sessionId: string, options?: StudioRequestOptions) => Promise<StudioScene>;
  reorderScenes: (sessionId: string, sceneIds: string[]) => Promise<StudioScene[]>;
  getSceneSnapshot: (
    sessionId: string,
    sceneId: string,
    options?: StudioRequestOptions
  ) => Promise<StudioSceneSnapshot>;
  createSceneRun: (
    sessionId: string,
    sceneId: string,
    input: StudioCreateSceneRunInput,
    options?: StudioRequestOptions
  ) => Promise<StudioCreateSceneRunResponse>;
  cancelRun: (runId: string) => Promise<StudioCinemaCancelResponse>;
}

export interface LocalFirstStudioPorts {
  sessionApi: StudioCinemaSessionGatewayApi;
  sceneApi: StudioCinemaApiPort;
}

export function createLocalFirstStudioPorts(input: {
  store: LocalStudioSessionStore;
  server: LocalFirstServerPort;
  /** 新会话的默认标题与项目，与托管形态保持一致。 */
  defaultTitle: string;
  projectId: string;
}): LocalFirstStudioPorts {
  const { store, server } = input;

  function requireRecord(sessionId: string): Promise<LocalStudioSessionRecord> {
    return store.read(sessionId).then((record) => {
      if (!record) {
        throw new StudioApiRequestError('This browser has no such session', 'NOT_FOUND');
      }
      return record;
    });
  }

  /**
   * 用绑定的服务端会话执行；服务端说没有（重启过）就在本地重建一次再重试。
   * 只对 `NOT_FOUND` 自愈：别的失败是真实失败，重试只会掩盖它。
   */
  async function withServerSession<T>(
    sessionId: string,
    run: (serverSessionId: string, record: LocalStudioSessionRecord) => Promise<T>
  ): Promise<T> {
    const record = await requireRecord(sessionId);

    if (record.serverSessionId) {
      try {
        return await run(record.serverSessionId, record);
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    }

    const serverSessionId = await recreateServerSession(record);
    return run(serverSessionId, (await store.read(sessionId)) ?? record);
  }

  /** 把一份本地会话重新落到服务端：先会话、再它现在持有的每个场景，并逐个重新绑定。 */
  async function recreateServerSession(record: LocalStudioSessionRecord): Promise<string> {
    const session = await server.createSession({
      projectId: record.projectId || input.projectId,
      title: record.title || input.defaultTitle,
      studioKind: record.studioKind as StudioCreateSessionInput['studioKind']
    });

    await store.bindServerSession(record.id, session.id);

    for (const scene of record.scenes) {
      const serverScene = await server.createScene(session.id);
      await store.upsertScene(record.id, {
        id: scene.id,
        source: scene.source,
        serverSceneId: serverScene.id
      });
    }

    return session.id;
  }

  async function serverSceneIdFor(record: LocalStudioSessionRecord, localSceneId: string): Promise<string> {
    const scene = record.scenes.find((candidate) => candidate.id === localSceneId);
    if (!scene) {
      throw new StudioApiRequestError('This browser has no such scene', 'NOT_FOUND');
    }
    if (!scene.serverSceneId) {
      await recreateServerSession(record);
      return serverSceneIdFor(await requireRecord(record.id), localSceneId);
    }
    return scene.serverSceneId;
  }

  /** `code` 的键与 Run 路径都是本地 id，服务端只认自己的 id：在这里整张表翻译一次。 */
  function translateSceneSources(
    record: LocalStudioSessionRecord,
    code: Record<string, string> | undefined
  ): Record<string, string> | undefined {
    if (!code) {
      return undefined;
    }

    const translated: Record<string, string> = {};
    for (const [localSceneId, source] of Object.entries(code)) {
      const scene = record.scenes.find((candidate) => candidate.id === localSceneId);
      const key = scene?.serverSceneId ?? localSceneId;
      translated[key] = source;
    }
    return translated;
  }

  async function sessionSnapshot(sessionId: string, options?: StudioRequestOptions): Promise<StudioSessionSnapshot> {
    return withServerSession(sessionId, async (serverSessionId, record) => {
      const snapshot = await server.getSessionSnapshot(serverSessionId, options);
      // 这一层看不到 SSE，所以它**按读吸收**：服务端已经知道的助手回复，读到就落进本地正文。
      await absorbAssistantMessages(store, record.id, snapshot.messages);

      return {
        ...snapshot,
        session: toSessionDto(record, snapshot.session),
        scenes: (snapshot.scenes ?? []).map((scene) => toLocalSceneDto(record, scene)),
        // 本地正文是展示的那一份：服务端可能刚重启过，它记的消息反而不全。
        messages: mergeMessages(
          snapshot.messages,
          toSessionMessages(record, serverSessionId)
        )
      };
    });
  }

  const sessionApi: StudioCinemaSessionGatewayApi = {
    createSession: async (createInput) => {
      const record = await store.create({
        studioKind: createInput.studioKind ?? 'manim',
        title: createInput.title ?? input.defaultTitle,
        projectId: createInput.projectId || input.projectId
      });

      const serverSessionId = await recreateServerSession(record);
      const bound = (await store.read(record.id)) ?? record;
      const snapshot = await server.getSessionSnapshot(serverSessionId);

      return toSessionDto(bound, snapshot.session);
    },

    getSessionSnapshot: (sessionId, options) => sessionSnapshot(sessionId, options),

    deleteSession: async (sessionId) => {
      const record = await store.read(sessionId);
      if (record?.serverSessionId) {
        try {
          await server.deleteSession(record.serverSessionId);
        } catch (error) {
          // 服务端已经不记得它了（重启过）：本地仍然要删干净，这不是失败。
          if (!isNotFound(error)) {
            throw error;
          }
        }
      }

      await store.remove(sessionId);
      return true;
    }
  };

  const sceneApi: StudioCinemaApiPort = {
    // Cinema 的 Scene 端口也读会话快照（它自己就是 Scene 作用域的那一份读）——直接沿用同一实现。
    getSessionSnapshot: (sessionId, options) => sessionSnapshot(sessionId, options),

    createScene: (sessionId, options) =>
      withServerSession(sessionId, async (serverSessionId, record) => {
        const created = await server.createScene(serverSessionId, options);
        // 新场景直接用服务端铸的 id 作为本地 id：它已经是随机且唯一的，本地再造一个只会让两份身份对不上。
        const updated = await store.upsertScene(record.id, {
          id: created.id,
          source: '',
          serverSceneId: created.id
        });
        return toLocalSceneDto(updated ?? record, created);
      }),

    reorderScenes: (sessionId, sceneIds) =>
      withServerSession(sessionId, async (serverSessionId, record) => {
        const serverSceneIds = await Promise.all(sceneIds.map((sceneId) => serverSceneIdFor(record, sceneId)));
        const reordered = await server.reorderScenes(serverSessionId, serverSceneIds);

        const serverIdToLocalId = new Map(
          record.scenes.map((scene) => [scene.serverSceneId, scene.id] as const)
        );
        return reordered.map((scene) => {
          const localId = serverIdToLocalId.get(scene.id) ?? scene.id;
          const localScene = record.scenes.find((candidate) => candidate.id === localId);
          return {
            ...scene,
            id: localId,
            sessionId,
            position: localScene?.position ?? scene.position
          };
        });
      }),

    getSceneSnapshot: (sessionId, sceneId, options) =>
      withServerSession(sessionId, async (serverSessionId, record) => {
        const serverSceneId = await serverSceneIdFor(record, sceneId);
        const snapshot = await server.getSceneSnapshot(serverSessionId, serverSceneId, options);
        await absorbAssistantMessages(store, record.id, snapshot.messages, serverSceneId, sceneId);

        return {
          ...snapshot,
          scene: { ...snapshot.scene, id: sceneId, sessionId },
          messages: mergeSceneMessages(
            snapshot.messages,
            toSceneMessages(record, serverSessionId, sceneId, serverSceneId)
          )
        };
      }),

    createSceneRun: (sessionId, sceneId, runInput, options) =>
      withServerSession(sessionId, async (serverSessionId, record) => {
        const serverSceneId = await serverSceneIdFor(record, sceneId);
        const context = await store.readRunContext(sessionId);
        const translatedCode = translateSceneSources(record, runInput.code);

        // 浏览器持有的代码也要留在本地：下一次 Run（或者服务端重启后的重建）从这里带走它。
        if (runInput.code) {
          for (const [localSceneId, source] of Object.entries(runInput.code)) {
            await store.upsertScene(sessionId, { id: localSceneId, source });
          }
        }

        // 浏览器持有的对话随 Run 一起交出去：服务端刚重启时，这是它唯一能拿到的上下文。
        const conversation = context?.conversation.length ? context.conversation : undefined;

        const response = await server.createSceneRun(
          serverSessionId,
          serverSceneId,
          {
            ...runInput,
            ...(translatedCode ? { code: translatedCode } : {}),
            ...(conversation ? { conversation } : {})
          },
          options
        );

        await store.recordMessage(sessionId, { role: 'user', text: runInput.inputText, sceneId });

        return {
          ...response,
          scene: { ...response.scene, id: sceneId, sessionId }
        };
      }),

    cancelRun: (runId) => server.cancelRun(runId)
  };

  return { sessionApi, sceneApi };
}

/** 服务端已经消失的那条会话，在它这边表现为 `NOT_FOUND`。 */
function isNotFound(error: unknown): boolean {
  return error instanceof StudioApiRequestError && error.code === 'NOT_FOUND';
}

function toSessionDto(record: LocalStudioSessionRecord, serverSession: StudioSession): StudioSession {
  return {
    ...serverSession,
    // UI 只认本地身份：它跨服务端重启稳定，所以重开页面看到的是同一个会话。
    id: record.id,
    title: record.title || serverSession.title,
    studioKind: record.studioKind as StudioSession['studioKind']
  };
}

function toLocalSceneDto(record: LocalStudioSessionRecord, serverScene: StudioScene): StudioScene {
  const scene = record.scenes.find(
    (candidate) => candidate.serverSceneId === serverScene.id || candidate.id === serverScene.id
  );

  return {
    ...serverScene,
    id: scene?.id ?? serverScene.id,
    sessionId: record.id,
    position: scene?.position ?? serverScene.position
  };
}

function toSessionMessages(record: LocalStudioSessionRecord, serverSessionId: string): StudioMessage[] {
  return record.messages.map((message): StudioMessage => {
    const base = {
      id: message.id,
      sessionId: serverSessionId,
      ...(sceneScope(message.sceneId, record) ? { sceneId: sceneScope(message.sceneId, record) } : {}),
      createdAt: message.createdAt,
      updatedAt: message.createdAt
    };

    if (message.role === 'user') {
      return { ...base, role: 'user', text: message.text };
    }

    return {
      ...base,
      role: 'assistant',
      agent: DEFAULT_AGENT,
      parts: [
        {
          id: `${message.id}_text`,
          messageId: message.id,
          sessionId: serverSessionId,
          type: 'text',
          text: message.text
        }
      ]
    };
  });
}

function toSceneMessages(
  record: LocalStudioSessionRecord,
  serverSessionId: string,
  localSceneId: string,
  serverSceneId: string
): StudioSceneMessage[] {
  return toSessionMessages(record, serverSessionId)
    .filter((message) => message.sceneId === serverSceneId)
    .map((message): StudioSceneMessage => ({
      ...message,
      sceneId: localSceneId,
      id: message.id
    }));
}

/** 本地 id → 服务端 id（该消息所属场景）。没有场景归属的消息不带作用域。 */
function sceneScope(localSceneId: string | undefined, record: LocalStudioSessionRecord): string | undefined {
  if (!localSceneId) {
    return undefined;
  }
  return record.scenes.find((candidate) => candidate.id === localSceneId)?.serverSceneId ?? undefined;
}

/**
 * 展示用的合并：服务端刚发生的消息（本地还没记）在前，本地正文补上服务端已经不记得的那些。
 * 按 (角色, 正文) 去重，所以同一条消息同时存在于两边时只出现一次。
 */
function mergeMessages(serverMessages: StudioMessage[], localMessages: StudioMessage[]): StudioMessage[] {
  const seen = new Set(serverMessages.map(messageKey));
  return [...serverMessages, ...localMessages.filter((message) => !seen.has(messageKey(message)))];
}

function mergeSceneMessages(
  serverMessages: StudioSceneMessage[],
  localMessages: StudioSceneMessage[]
): StudioSceneMessage[] {
  const seen = new Set(serverMessages.map(messageKey));
  return [...serverMessages, ...localMessages.filter((message) => !seen.has(messageKey(message)))];
}

function messageKey(message: StudioMessage | StudioSceneMessage): string {
  if (message.role === 'user') {
    return `user:${message.text ?? ''}`;
  }

  const parts = 'parts' in message ? message.parts ?? [] : [];
  const text = parts
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('');
  return `assistant:${text}`;
}

const DEFAULT_AGENT: StudioAgentType = 'builder';

/**
 * 把服务端已知的助手回复吸收进本地正文。本地已经有同文的一条时不再重复。
 * 作用域取服务端的 sceneId 或调用方给的本地 sceneId ：历史面板按场景读。
 */
async function absorbAssistantMessages(
  store: LocalStudioSessionStore,
  localSessionId: string,
  serverMessages: Array<StudioMessage | StudioSceneMessage>,
  serverSceneId?: string,
  localSceneId?: string
): Promise<void> {
  for (const message of serverMessages) {
    if (message.role !== 'assistant') {
      continue;
    }

    const text = assistantText(message);
    if (!text) {
      continue;
    }

    // 场景作用域要翻译回本地 id；会话级消息（没有场景）就不带作用域。
    const serverScope = 'sceneId' in message ? message.sceneId : undefined;
    const sceneId = serverScope && serverScope === serverSceneId ? localSceneId : undefined;

    await store.recordMessageOnce(localSessionId, {
      role: 'assistant',
      text,
      ...(sceneId ? { sceneId } : {})
    });
  }
}

function assistantText(message: StudioMessage | StudioSceneMessage): string {
  if (!('parts' in message)) {
    return '';
  }

  return (message.parts ?? [])
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}
