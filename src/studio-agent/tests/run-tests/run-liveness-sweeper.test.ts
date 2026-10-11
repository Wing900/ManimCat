import assert from 'node:assert/strict'
import type { StudioRun } from '../../domain/types'
import {
  createStudioRunLivenessSweeper,
  type StudioRunLivenessSweeperPort
} from '../../infrastructure/coordination/studio-run-liveness-sweeper'
import type { StudioRunScopeLiveness } from '../../infrastructure/coordination/studio-run-coordination-service'
import type { StudioRunCoordinationScope } from '../../infrastructure/coordination/studio-run-scope'
import { canonicalStudioRunScopeKey } from '../../infrastructure/coordination/studio-run-scope'
import { RecordingStudioRunCoordinationLogger } from '../support/fake-studio-run-coordinator'
import { run } from './factories'

/**
 * The liveness sweep exists because a Run's status outlives its worker: when the process that would
 * finish a Run dies, the row keeps saying `running` and only the lease can tell that nobody is left.
 *
 * These specifications pin the three rules that make it safe to run on every replica at once, and the
 * two ways it could do damage: killing a Run that is alive, and killing every Run at once because the
 * registry answered with silence.
 */
const NOW = Date.parse('2026-07-01T12:00:00.000Z')
const GRACE_MS = 90_000

function makeRun(overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id: 'run-1',
    ownerId: 'owner-1',
    sessionId: 'session-1',
    status: 'running',
    inputText: 'draw a circle',
    activeAgent: 'builder',
    createdAt: new Date(NOW - 10 * 60_000).toISOString(),
    ...overrides,
  }
}

function createHarness(input: {
  runs: StudioRun[]
  liveness?: StudioRunScopeLiveness | (() => Promise<StudioRunScopeLiveness>)
  reconcileResult?: boolean
  listError?: Error
}) {
  const sequence: string[] = []
  const reconcileCalls: Array<{ ownerId: string; scope: StudioRunCoordinationScope }> = []
  const logger = new RecordingStudioRunCoordinationLogger()

  const port: StudioRunLivenessSweeperPort = {
    listActiveRuns: async (_limit: number) => {
      sequence.push('list')
      if (input.listError) {
        throw input.listError
      }
      return input.runs
    },
    readScopeLiveness: async (scope) => {
      sequence.push(`liveness:${canonicalStudioRunScopeKey(scope)}`)
      const answer = input.liveness ?? 'free'
      return typeof answer === 'function' ? answer() : answer
    },
    reconcileScopeRuns: async (call) => {
      sequence.push(`reconcile:${canonicalStudioRunScopeKey(call.scope)}`)
      reconcileCalls.push(call)
      return input.reconcileResult ?? true
    },
  }

  const sweeper = createStudioRunLivenessSweeper({
    port,
    logger,
    now: () => NOW,
    graceMs: GRACE_MS,
  })

  return {
    sweeper,
    logger,
    sequence,
    reconcileCalls,
    async sweep(): Promise<void> {
      await sweeper.sweepOnce()
    },
  }
}

export async function runRunLivenessSweeperTests(): Promise<void> {
  await run('a Run whose scope nobody holds is finalized once it has stopped showing signs of life', async () => {
    const harness = createHarness({ runs: [makeRun()] })

    await harness.sweep()

    assert.equal(harness.reconcileCalls.length, 1)
    assert.deepEqual(harness.reconcileCalls[0], {
      ownerId: 'owner-1',
      scope: { kind: 'legacy-session', sessionId: 'session-1' },
    })
  })

  await run('a Run whose scope is held is left alone', async () => {
    const harness = createHarness({ runs: [makeRun()], liveness: 'held' })

    await harness.sweep()

    assert.deepEqual(harness.sequence, ['list', 'liveness:legacy:session-1'])
    assert.equal(harness.reconcileCalls.length, 0, 'a live owner means the Run is alive')
  })

  await run('an unknown answer is never read as free', async () => {
    const harness = createHarness({ runs: [makeRun()], liveness: 'unknown' })

    await harness.sweep()

    assert.equal(harness.reconcileCalls.length, 0, 'an unreachable registry must not execute Runs')
    assert.ok(
      harness.logger.entries.some((entry) => entry.level === 'warn'),
      'the unknown answer is reported instead of acted on'
    )
  })

  await run('a Run that is still fresh is left alone even when its scope looks free', async () => {
    const harness = createHarness({
      runs: [
        makeRun({
          metadata: { autonomy: { lastCheckpointAt: new Date(NOW - 1_000).toISOString() } },
        }),
      ],
    })

    await harness.sweep()

    assert.deepEqual(harness.sequence, ['list'], 'a recent checkpoint is a sign of life')
    assert.equal(harness.reconcileCalls.length, 0)
  })

  await run('a fresh Run protects every Run of its scope', async () => {
    // Reconciliation finalizes the whole scope, so acting here would take the live sibling with it.
    const harness = createHarness({
      runs: [
        makeRun({ id: 'run-old' }),
        makeRun({
          id: 'run-fresh',
          metadata: { autonomy: { lastCheckpointAt: new Date(NOW - 1_000).toISOString() } },
        }),
      ],
    })

    await harness.sweep()

    assert.equal(harness.reconcileCalls.length, 0)
  })

  await run('the active list is read before any liveness question is asked', async () => {
    // This order is the safety argument: a Run created after the read cannot be in it, so a replica
    // that acquires the scope in between can never have its fresh Run declared dead.
    const harness = createHarness({ runs: [makeRun()] })

    await harness.sweep()

    assert.deepEqual(harness.sequence, ['list', 'liveness:legacy:session-1', 'reconcile:legacy:session-1'])
  })

  await run('a terminal Run is never touched even when it is listed', async () => {
    const harness = createHarness({
      runs: [makeRun({ id: 'run-done', status: 'completed' }), makeRun({ id: 'run-cancelled', status: 'cancelled' })],
    })

    await harness.sweep()

    assert.deepEqual(harness.sequence, ['list'], 'a terminal status is not the sweep\'s business')
    assert.equal(harness.reconcileCalls.length, 0)
  })

  await run('only the scopes nobody holds are reconciled', async () => {
    const harness = createHarness({
      runs: [makeRun({ id: 'run-a', sessionId: 'session-a' }), makeRun({ id: 'run-b', sessionId: 'session-b' })],
      liveness: (() => {
        // First scope held, second free, by call order.
        let call = 0
        return async () => {
          call += 1
          return call === 1 ? 'held' : 'free'
        }
      })(),
    })

    await harness.sweep()

    assert.equal(harness.reconcileCalls.length, 1)
    assert.equal(harness.reconcileCalls[0].scope.sessionId, 'session-b')
  })

  await run('a Scene Run is judged on its Scene scope, a legacy Run on its Session', async () => {
    const harness = createHarness({
      runs: [
        makeRun({ id: 'run-scene', sceneId: 'scene-1' }),
        makeRun({ id: 'run-legacy', sessionId: 'session-2' }),
      ],
    })

    await harness.sweep()

    assert.deepEqual(
      harness.reconcileCalls.map((call) => call.scope),
      [
        { kind: 'scene', sessionId: 'session-1', sceneId: 'scene-1' },
        { kind: 'legacy-session', sessionId: 'session-2' },
      ]
    )
  })

  await run('a refused reconciliation is reported and never retried as if it had worked', async () => {
    const harness = createHarness({ runs: [makeRun()], reconcileResult: false })

    await harness.sweep()

    assert.equal(harness.reconcileCalls.length, 1)
    assert.ok(harness.logger.entries.some((entry) => entry.level === 'warn'))
  })

  await run('a failing query is logged and never escapes the sweep', async () => {
    const harness = createHarness({ runs: [makeRun()], listError: new Error('database is unreachable') })

    await harness.sweep()

    assert.equal(harness.reconcileCalls.length, 0)
    assert.ok(harness.logger.entries.some((entry) => entry.level === 'error'))
  })

  await run('a slow sweep is skipped rather than stacked', async () => {
    let release: () => void = () => undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let listCalls = 0
    const sweeper = createStudioRunLivenessSweeper({
      logger: new RecordingStudioRunCoordinationLogger(),
      now: () => NOW,
      graceMs: GRACE_MS,
      port: {
        listActiveRuns: async () => {
          listCalls += 1
          await blocked
          return [makeRun()]
        },
        readScopeLiveness: async () => 'held',
        reconcileScopeRuns: async () => true,
      },
    })

    const first = sweeper.sweepOnce()
    const second = sweeper.sweepOnce()
    release()
    await Promise.all([first, second])

    assert.equal(listCalls, 1, 'two sweeps in flight would double every query')
  })
}
