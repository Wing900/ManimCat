import { describe, expect, it } from 'vitest'
import { StudioApiRequestError } from '../../api/client'
import type { StudioSession, StudioSessionSnapshot } from '../../protocol/studio-agent-types'
import {
  StudioCinemaSessionGateway,
  readStudioCinemaSessionCandidates,
  type StudioCinemaSessionGatewayDependencies,
} from './studio-cinema-session-gateway'

/**
 * Session gateway specs (task 11C2, section 4).
 *
 * The gateway is the only place that decides *which* Session the Cinema workspace talks to, so these
 * specs drive it with a programmable API and an in-memory storage: no fetch, no socket, no timer. What
 * is asserted is the contract the UI relies on — a definite 404 is forgotten, a transport failure is
 * not, and one intent can never produce two Sessions.
 */

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createSession(sessionId: string): StudioSession {
  return {
    id: sessionId,
    projectId: 'manimcat-studio',
    studioKind: 'manim',
    agentType: 'builder',
    title: 'Manim Studio',
    directory: '/workspace/session',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function snapshotOf(sessionId: string): StudioSessionSnapshot {
  return { session: createSession(sessionId), messages: [], runs: [], renders: [], scenes: [] }
}

interface Harness {
  gateway: StudioCinemaSessionGateway
  storage: Map<string, string>
  recent: string[]
  created: string[]
  restored: string[]
  setSnapshot: (sessionId: string, response: () => Promise<StudioSessionSnapshot>) => void
}

function createHarness(options?: {
  createSession?: () => Promise<StudioSession>
  snapshots?: Record<string, () => Promise<StudioSessionSnapshot>>
  /** Ownership of the caller (correction R5): a detached binding answers false. */
  isOwned?: () => boolean
}): Harness {
  const storage = new Map<string, string>()
  const recent: string[] = []
  const created: string[] = []
  const restored: string[] = []
  const snapshots: Record<string, () => Promise<StudioSessionSnapshot>> = { ...options?.snapshots }

  const deps: StudioCinemaSessionGatewayDependencies = {
    api: {
      createSession: () => {
        if (options?.createSession) {
          return options.createSession()
        }
        const session = createSession(`session_created_${created.length + 1}`)
        created.push(session.id)
        return Promise.resolve(session)
      },
      getSessionSnapshot: (sessionId) => {
        restored.push(sessionId)
        const respond = snapshots[sessionId]
        return respond ? respond() : Promise.resolve(snapshotOf(sessionId))
      },
    },
    storage: {
      readLastSessionId: () => recent[0] ?? null,
      readRecentSessionIds: () => [...recent],
      rememberSessionId: (_studioKind, sessionId) => {
        // Matches the real store: remembering a Session moves it to the front of the recent list.
        storage.set('last', sessionId)
        const index = recent.indexOf(sessionId)
        if (index >= 0) {
          recent.splice(index, 1)
        }
        recent.unshift(sessionId)
      },
      markLastSessionId: (_studioKind, sessionId) => {
        // Matches the real store: only the last-used pointer moves; the list keeps its order.
        storage.set('last', sessionId)
      },
      forgetSessionId: (_studioKind, sessionId) => {
        const index = recent.indexOf(sessionId)
        if (index >= 0) {
          recent.splice(index, 1)
        }
      },
    },
    createAbortController: () => new AbortController(),
    projectId: 'manimcat-studio',
    defaultTitle: 'Manim Studio',
    ...(options?.isOwned ? { isOwned: options.isOwned } : {}),
  }

  return {
    gateway: new StudioCinemaSessionGateway(deps),
    storage,
    recent,
    created,
    restored,
    setSnapshot: (sessionId, response) => {
      snapshots[sessionId] = response
    },
  }
}

describe('cinema session gateway', () => {
  it('orders restore candidates by last use and never repeats one', () => {
    const candidates = readStudioCinemaSessionCandidates(
      {
        readLastSessionId: () => 'session_b',
        readRecentSessionIds: () => ['session_a', 'session_b', 'session_c'],
        rememberSessionId: () => undefined,
        markLastSessionId: () => undefined,
        forgetSessionId: () => undefined,
      },
      'manim',
    )

    expect(candidates).toEqual(['session_b', 'session_a', 'session_c'])
  })

  it('creates exactly one session when the same intent is started twice (StrictMode replay)', async () => {
    const deferred = createDeferred<StudioSession>()
    let createCalls = 0
    const harness = createHarness({
      createSession: () => {
        createCalls += 1
        return deferred.promise
      },
    })

    const first = harness.gateway.open('manim')
    const second = harness.gateway.open('manim')
    expect(createCalls).toBe(1)

    deferred.resolve(createSession('session_new'))
    await expect(first).resolves.toEqual({
      status: 'ready',
      origin: 'created',
      session: expect.objectContaining({ id: 'session_new' }),
    })
    await expect(second).resolves.toEqual(expect.objectContaining({ status: 'ready' }))
    expect(createCalls).toBe(1)
    expect(harness.recent).toEqual(['session_new'])
  })

  it('restores the most recent reachable session without creating one', async () => {
    const harness = createHarness()
    harness.recent.push('session_old')

    const outcome = await harness.gateway.open('manim')

    expect(outcome).toEqual({
      status: 'ready',
      origin: 'restored',
      session: expect.objectContaining({ id: 'session_old' }),
    })
    expect(harness.created).toEqual([])
    expect(harness.recent).toEqual(['session_old'])
  })

  it('forgets a history entry only on a definite 404 and tries the next one', async () => {
    const harness = createHarness({
      snapshots: {
        session_gone: () =>
          Promise.reject(new StudioApiRequestError('Session not found', 'NOT_FOUND')),
      },
    })
    harness.recent.push('session_gone', 'session_alive')

    const outcome = await harness.gateway.open('manim')

    expect(outcome).toEqual({
      status: 'ready',
      origin: 'restored',
      session: expect.objectContaining({ id: 'session_alive' }),
    })
    expect(harness.recent).toEqual(['session_alive'])
    expect(harness.created).toEqual([])
  })

  it('keeps the history and reports an unavailable restore when the server cannot answer', async () => {
    const harness = createHarness({
      snapshots: {
        session_flaky: () => Promise.reject(new TypeError('Failed to fetch')),
      },
    })
    harness.recent.push('session_flaky')

    const outcome = await harness.gateway.open('manim')

    expect(outcome).toEqual({
      status: 'unavailable',
      reason: 'restore_unavailable',
      sessionId: 'session_flaky',
    })
    // A temporary outage must never look like a deleted Session, and must never create a new one.
    expect(harness.recent).toEqual(['session_flaky'])
    expect(harness.created).toEqual([])
  })

  it('never falls back to creating a session when an explicitly picked entry is gone', async () => {
    const harness = createHarness({
      snapshots: {
        session_gone: () =>
          Promise.reject(new StudioApiRequestError('Session not found', 'NOT_FOUND')),
      },
    })
    harness.recent.push('session_gone')

    const outcome = await harness.gateway.restore('manim', 'session_gone')

    expect(outcome).toEqual({ status: 'unavailable', reason: 'restore_missing', sessionId: 'session_gone' })
    expect(harness.recent).toEqual([])
    expect(harness.created).toEqual([])
  })

  // Picking an entry out of the middle of the list must be visible where the user clicked: the entry
  // stays put and only the last-used pointer follows it. A reorder would move the clicked row to the
  // top, which is indistinguishable from "nothing happened" in a list of identically named Sessions.
  it('keeps the recent order when one entry is picked explicitly', async () => {
    const harness = createHarness()
    harness.recent.push('session_newest', 'session_middle', 'session_oldest')

    const outcome = await harness.gateway.restore('manim', 'session_middle')

    expect(outcome).toEqual(expect.objectContaining({ status: 'ready', origin: 'restored' }))
    expect(harness.recent).toEqual(['session_newest', 'session_middle', 'session_oldest'])
    expect(harness.storage.get('last')).toBe('session_middle')
  })

  it('drops a restore response that a newer intent already superseded', async () => {
    const deferred = createDeferred<StudioSessionSnapshot>()
    const harness = createHarness({ snapshots: { session_old: () => deferred.promise } })
    harness.recent.push('session_old')

    const stale = harness.gateway.open('manim')
    const fresh = harness.gateway.createNew('manim')

    await expect(fresh).resolves.toEqual(expect.objectContaining({ status: 'ready', origin: 'created' }))
    deferred.resolve(snapshotOf('session_old'))

    // The late restore belongs to a superseded intent: it resolves as stale and writes no storage.
    await expect(stale).resolves.toEqual({ status: 'stale' })
  })

  it('resolves as stale, issues no request and writes no history when the caller is gone', async () => {
    const harness = createHarness({ isOwned: () => false })
    harness.recent.push('session_old')

    await expect(harness.gateway.open('manim')).resolves.toEqual({ status: 'stale' })
    expect(harness.storage.size).toBe(0)
    expect(harness.created).toEqual([])
    // The unowned intent does not even leave the client.
    expect(harness.restored).toEqual([])
  })

  it('answers stale when a create rejects after the caller detached', async () => {
    const deferred = createDeferred<StudioSession>()
    let owned = true
    const harness = createHarness({
      createSession: () => deferred.promise,
      isOwned: () => owned,
    })

    const pending = harness.gateway.createNew('manim')
    owned = false
    deferred.reject(new TypeError('Failed to fetch'))

    // A detached caller learns nothing about a failure it can no longer apply.
    await expect(pending).resolves.toEqual({ status: 'stale' })
    expect(harness.storage.size).toBe(0)
  })

  it('writes no history for a forget issued by a detached caller', async () => {
    const harness = createHarness({ isOwned: () => false })
    harness.recent.push('session_old')

    expect(harness.gateway.forget('manim', 'session_old')).toBe(false)
    expect(harness.recent).toEqual(['session_old'])
    expect(harness.storage.size).toBe(0)
  })

  it('stops a restore sweep whose owner detached while it was reading', async () => {
    const deferred = createDeferred<StudioSessionSnapshot>()
    let owned = true
    const harness = createHarness({
      isOwned: () => owned,
      snapshots: { session_old: () => deferred.promise },
    })
    harness.recent.push('session_old', 'session_older')

    const pending = harness.gateway.open('manim')
    owned = false
    deferred.resolve(snapshotOf('session_old'))

    await expect(pending).resolves.toEqual({ status: 'stale' })
    expect(harness.storage.size).toBe(0)
    // The sweep never reached the second candidate: a detached binding abandons it at the boundary.
    expect(harness.restored).toEqual(['session_old'])
  })

  it('records no history for a create that finishes after the caller detached', async () => {
    const deferred = createDeferred<StudioSession>()
    let owned = true
    const harness = createHarness({
      createSession: () => deferred.promise,
      isOwned: () => owned,
    })

    const pending = harness.gateway.createNew('manim')
    owned = false
    deferred.resolve(createSession('session_orphan'))

    // The request already left the client, so the Session may exist on the server; the outcome is
    // unknown for this caller and nothing is written for a screen that is gone.
    await expect(pending).resolves.toEqual({ status: 'stale' })
    expect(harness.storage.size).toBe(0)
    expect(harness.recent).toEqual([])
  })

  it('reports a definite create failure separately from an unknown one', async () => {
    const failing = createHarness({
      createSession: () => Promise.reject(new StudioApiRequestError('Server error', 'INTERNAL_ERROR')),
    })
    await expect(failing.gateway.createNew('manim')).resolves.toEqual({
      status: 'unavailable',
      reason: 'create_failed',
      sessionId: null,
    })

    const unparsable = createHarness({
      createSession: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    await expect(unparsable.gateway.createNew('manim')).resolves.toEqual({
      status: 'unavailable',
      reason: 'create_unknown',
      sessionId: null,
    })
  })
})
