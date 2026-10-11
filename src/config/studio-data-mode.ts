/**
 * Studio 数据放在哪里 —— 一套部署形态，两种设施。
 *
 * `server`（默认）是托管形态：会话、消息、场景、渲染记录都写进服务端数据库，后端重启后仍然在。
 *
 * `client` 是本地优先形态：**对话与场景内容由浏览器持有**，服务端只在一次 Run 期间于内存里
 * 处理，不落库。因此它强制内存持久化（见 create-default-studio-persistence.ts）—— 重启后服务端
 * 没有任何 Session 行，由前端把这次 Run 需要的上下文重新喂进来。
 *
 * 无论哪种形态，模型调用都在服务端（CatKey 模式的上游凭据不下发到浏览器）。
 */
export type StudioDataMode = 'server' | 'client'

/**
 * 读取部署形态。无法识别的值一律按 `server` 处理：默认形态必须是「数据留在服务端」，
 * 不能因为一个拼错的变量名让用户的对话落到本地而没人知道。
 */
export function getStudioDataMode(): StudioDataMode {
  return process.env.STUDIO_DATA_MODE?.trim().toLowerCase() === 'client' ? 'client' : 'server'
}

export function isStudioClientDataMode(): boolean {
  return getStudioDataMode() === 'client'
}
