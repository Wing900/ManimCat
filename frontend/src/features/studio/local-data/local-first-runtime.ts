import {
  cancelStudioRun,
  createStudioScene,
  createStudioSceneRun,
  createStudioSession,
  deleteStudioSession,
  getStudioSceneSnapshot,
  getStudioSessionSnapshot,
  reorderStudioScenes
} from '../api/studio-agent-api';
import { isStudioClientDataMode } from '../../../infrastructure/api/runtime-config';
import { createDefaultLocalStudioSessionStore, type LocalStudioSessionStore } from './local-session-store';
import {
  createLocalFirstStudioPorts,
  type LocalFirstServerPort,
  type LocalFirstStudioPorts
} from './local-first-studio-ports';

/**
 * 客户端形态的**唯一装配点**：谁把本地存储接进 UI，只有这一个文件。
 *
 * 托管形态一行都不经过这里：`isStudioClientDataMode()` 为 false 时，UI 拿到的仍然是直连服务端的端口，
 * 行为与今天完全一致。
 */
const serverPort: LocalFirstServerPort = {
  createSession: (input) => createStudioSession(input),
  getSessionSnapshot: (sessionId, options) => getStudioSessionSnapshot(sessionId, options),
  deleteSession: (sessionId) => deleteStudioSession(sessionId),
  createScene: (sessionId, options) => createStudioScene(sessionId, options),
  reorderScenes: (sessionId, sceneIds) => reorderStudioScenes(sessionId, sceneIds),
  getSceneSnapshot: (sessionId, sceneId, options) => getStudioSceneSnapshot(sessionId, sceneId, options),
  createSceneRun: (sessionId, sceneId, input, options) =>
    createStudioSceneRun(sessionId, sceneId, input, options),
  cancelRun: (runId) => cancelStudioRun({ runId })
};

let store: LocalStudioSessionStore | null = null;
let ports: LocalFirstStudioPorts | null = null;

export function getLocalStudioSessionStore(): LocalStudioSessionStore {
  if (!store) {
    store = createDefaultLocalStudioSessionStore();
  }
  return store;
}

/**
 * 端口是单例：状态都在本地存储里，端口本身无状态，所以场景层与会话层共用一份即可。
 * 标题与项目只是兜底 —— 真正的新会话标题由调用方给出。
 */
export function getLocalFirstStudioPorts(): LocalFirstStudioPorts {
  if (!ports) {
    ports = createLocalFirstStudioPorts({
      store: getLocalStudioSessionStore(),
      server: serverPort,
      defaultTitle: 'Studio',
      projectId: 'manimcat-studio'
    });
  }
  return ports;
}

export function isClientDataShape(): boolean {
  return isStudioClientDataMode();
}

/** 测试接缝：换掉本地存储与端口（形态判定本身由 runtime-config 控制）。 */
export function setLocalFirstStudioPortsForTests(next: LocalFirstStudioPorts | null): void {
  ports = next;
}
