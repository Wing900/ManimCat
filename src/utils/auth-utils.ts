/**
 * Bearer 提取。
 *
 * 访问控制本身已经搬进 `../access`：这里只剩这一个纯格式工具，不含任何凭据校验。
 */
export function extractBearerToken(authHeader: string | string[] | undefined): string {
  if (!authHeader) return ''

  if (typeof authHeader === 'string') {
    return authHeader.replace(/^Bearer\s+/i, '')
  }

  if (Array.isArray(authHeader)) {
    return authHeader[0]?.replace(/^Bearer\s+/i, '') || ''
  }

  return ''
}
