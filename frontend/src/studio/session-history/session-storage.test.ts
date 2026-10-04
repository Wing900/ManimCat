import { beforeEach, describe, expect, it } from 'vitest'
import {
  forgetStudioSessionId,
  readLastStudioSessionId,
  readRecentStudioSessionIds,
  rememberStudioSessionId,
} from './session-storage'

/**
 * The stored list is in recency order: the most recent Session first, the cap dropping the oldest
 * entries from the end. The sidebar reads the same ids the other way up (a feed, newest at the
 * bottom) — that flip lives in `useStudioCinemaSession`, so this module's order is the one pinned
 * here, and the gateway's restore candidates depend on it.
 */
describe('studio session storage', () => {
  const kind = 'manim'

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('puts a new Session at the front of the list, after the last-used pointer', () => {
    rememberStudioSessionId(kind, 'a')
    rememberStudioSessionId(kind, 'b')
    rememberStudioSessionId(kind, 'c')

    expect(readRecentStudioSessionIds(kind)).toEqual(['c', 'b', 'a'])
    expect(readLastStudioSessionId(kind)).toBe('c')
  })

  it('moves a re-selected Session to the front instead of listing it twice', () => {
    rememberStudioSessionId(kind, 'a')
    rememberStudioSessionId(kind, 'b')
    rememberStudioSessionId(kind, 'a')

    expect(readRecentStudioSessionIds(kind)).toEqual(['a', 'b'])
  })

  it('drops the oldest entries past the cap and keeps the newest twelve', () => {
    for (let index = 0; index < 15; index += 1) {
      rememberStudioSessionId(kind, `s${index}`)
    }

    const ids = readRecentStudioSessionIds(kind)
    expect(ids).toHaveLength(12)
    expect(ids[0]).toBe('s14')
    expect(ids.at(-1)).toBe('s3')
  })

  it('falls back to the most recent remaining Session when the current one is gone', () => {
    rememberStudioSessionId(kind, 'a')
    rememberStudioSessionId(kind, 'b')
    forgetStudioSessionId(kind, 'b')

    expect(readRecentStudioSessionIds(kind)).toEqual(['a'])
    expect(readLastStudioSessionId(kind)).toBe('a')
  })

  it('clears the last Session once the list is empty', () => {
    rememberStudioSessionId(kind, 'a')
    forgetStudioSessionId(kind, 'a')

    expect(readRecentStudioSessionIds(kind)).toEqual([])
    expect(readLastStudioSessionId(kind)).toBeNull()
  })
})
