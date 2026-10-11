/**
 * 本地会话记录 —— `STUDIO_DATA_MODE=client` 形态下，浏览器持有的那份真身。
 *
 * 这里刻意**只**放浏览器真正拥有的东西：会话身份、标题、场景源码、对话正文。服务端独有的事实
 * （Run id、渲染 job、工作区路径）一概不存：它们随服务端进程消失，存下来只会承诺一种不存在的连续性。
 */
export interface LocalStudioMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface LocalStudioScene {
  /** 本地身份：跨服务端重启稳定。 */
  id: string;
  /** 当前绑定的服务端场景；服务端重启后为 `null`，由本地重新创建。 */
  serverSceneId: string | null;
  position: number;
  /** Python 源码。浏览器持有代码，服务端每次 Run 把它重新写进工作区。 */
  source: string;
  updatedAt: string;
}

export interface LocalStudioSessionRecord {
  /** 本地身份：跨服务端重启稳定，UI 显示的一直是它。 */
  id: string;
  studioKind: string;
  title: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  serverSessionId: string | null;
  scenes: LocalStudioScene[];
  messages: LocalStudioMessage[];
}

export interface LocalStudioSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** 一次 Run 需要的东西：它被给定的对话，以及这份会话当前的场景源码。 */
export interface LocalStudioRunContext {
  conversation: Array<{ role: 'user' | 'assistant'; text: string }>;
  sceneSources: Array<{ localSceneId: string; serverSceneId: string | null; source: string }>;
}
