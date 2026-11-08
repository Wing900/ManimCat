/**
 * Turns an API error message into "the user has a connection problem" instead of a red error card.
 *
 * The backend answers a missing credential with 401 + a Chinese message; `localizeApiMessage`
 * translates it for en-US. Both spellings have to match here, because this decision is made after
 * localisation.
 */
export type ConnectionIssue = 'missing' | 'invalid'

const MISSING_MARKERS = [
  '缺少 API 密钥',
  'Missing API key',
]

const INVALID_MARKERS = [
  '无效的 authorization 头格式',
  'Invalid Authorization header format',
  '无效的 API 密钥',
  'Invalid API key',
  '无法识别的 API 密钥格式',
  'Unrecognized API key format',
  '该 CatKey 已被停用',
  'This CatKey has been revoked',
  '服务端未配置 CatKey 上游',
  'The service has no CatKey upstream',
]

export function classifyConnectionError(message: string | null | undefined): ConnectionIssue | null {
  if (!message) return null
  if (MISSING_MARKERS.some((marker) => message.includes(marker))) return 'missing'
  if (INVALID_MARKERS.some((marker) => message.includes(marker))) return 'invalid'
  return null
}
