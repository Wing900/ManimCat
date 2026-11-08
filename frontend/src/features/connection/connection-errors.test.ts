import { describe, expect, it } from 'vitest'
import { classifyConnectionError } from './connection-errors'

describe('classifyConnectionError', () => {
  it('treats a missing credential as missing', () => {
    expect(classifyConnectionError('缺少 API 密钥。请在 Authorization 头中提供 Bearer 令牌。')).toBe('missing')
    expect(classifyConnectionError('Missing API key. Provide a Bearer token in the Authorization header.')).toBe('missing')
  })

  it('treats a rejected credential as invalid', () => {
    expect(classifyConnectionError('无效的 API 密钥。')).toBe('invalid')
    expect(classifyConnectionError('该 CatKey 已被停用。')).toBe('invalid')
    expect(classifyConnectionError('This CatKey has been revoked.')).toBe('invalid')
    expect(classifyConnectionError('无法识别的 API 密钥格式。')).toBe('invalid')
  })

  it('leaves unrelated failures alone', () => {
    expect(classifyConnectionError('规划卡格式修复失败，请重试。')).toBeNull()
    expect(classifyConnectionError('fetch failed')).toBeNull()
    expect(classifyConnectionError(null)).toBeNull()
    expect(classifyConnectionError(undefined)).toBeNull()
    expect(classifyConnectionError('')).toBeNull()
  })
})
