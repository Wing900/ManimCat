import { API_BASE } from './api';

/**
 * 这套前端此刻运行在哪种形态下 —— 由服务端告知（`GET /api/runtime-config`）。
 *
 * 前端只构建一次，所以这不能是构建期开关：同一份 bundle 必须能当托管形态（`server`），也能当本地
 * 优先形态（`client`，会话数据由浏览器持有）。**任何失败都回答 `server`** —— 探测不到绝不悄悄把
 * 用户的对话搬进浏览器。
 */
export type StudioDataMode = 'server' | 'client';

let resolved: StudioDataMode | null = null;
let pending: Promise<StudioDataMode> | null = null;

/** 已解析出的形态；还没问过服务端时为 `null`。 */
export function peekStudioDataMode(): StudioDataMode | null {
  return resolved;
}

export function isStudioClientDataMode(): boolean {
  return resolved === 'client';
}

/**
 * 问一次服务端并记住答案。同一份进程内只发一次请求：形态在一次部署里不会变，
 * 而每个会话都要知道它。
 */
export async function loadStudioDataMode(): Promise<StudioDataMode> {
  if (resolved) {
    return resolved;
  }

  if (!pending) {
    pending = fetch(`${API_BASE}/runtime-config`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { studioDataMode?: unknown } | null) =>
        body?.studioDataMode === 'client' ? ('client' as const) : ('server' as const)
      )
      .catch(() => 'server' as const)
      .then((mode) => {
        resolved = mode;
        pending = null;
        return mode;
      });
  }

  return pending;
}

/** 测试接缝：忘掉已解析的形态与正在飞的探测。 */
export function resetStudioDataMode(): void {
  resolved = null;
  pending = null;
}
