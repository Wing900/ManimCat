import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  accumulateStudioTokenUsage,
  createEmptyStudioTokenUsage,
  createInMemoryStudioPersistence,
  createStudioAssistantMessage,
  createStudioRun,
  createStudioSession,
  createSupabaseStudioPersistence,
  InMemoryStudioEventBus,
  normalizeStudioModelUsage,
  readStudioTokenUsage,
  StudioTokenUsageTracker,
  StudioToolRegistry,
  cancelRunState,
  failRunState,
  finalizeRunState,
  type StudioCallTokenUsage,
  type StudioRun,
  type StudioTokenUsage,
  type StudioToolDefinition
} from '../../index'
import { toPublicStudioEvent, toPublicStudioRun } from '../../http/public-dto'
import { createStudioOpenAIToolLoop } from '../../orchestration/openai-tool-loop/controller'
import type { StudioModelPort, StudioModelResponse } from '../../model/studio-model-port'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { RecordingEventBus } from '../support/recording-event-bus'
import { ScriptedStudioModel } from '../support/scripted-studio-model'
import { run } from './factories'

const ZERO_USAGE: StudioTokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  measuredCalls: 0,
  unmeasuredCalls: 0
}

type Insertable = Record<string, unknown>

interface RunRowBuilder {
  insert(row: Insertable): RunRowBuilder
  update(payload: Insertable): RunRowBuilder
  select(columns?: string): RunRowBuilder
  eq(column: string, value: string): RunRowBuilder
  single(): { data: Insertable | null; error: null }
  maybeSingle(): { data: Insertable | null; error: null }
}

/** Supabase run-table spy: captures insert/update payloads and echoes the stored row. */
function createRunRowSpy(input?: { row?: Insertable }): {
  client: SupabaseClient
  insertedRow: () => Insertable | null
  updatedRow: () => Insertable | null
} {
  let insertedRow: Insertable | null = null
  let updatedRow: Insertable | null = null
  let storedRow: Insertable | null = input?.row ?? null

  const builder: RunRowBuilder = {
    insert(row) {
      insertedRow = row
      storedRow = row
      return builder
    },
    update(payload) {
      updatedRow = payload
      storedRow = { ...(storedRow ?? {}), ...payload }
      return builder
    },
    select() {
      return builder
    },
    eq() {
      return builder
    },
    single() {
      return { data: storedRow, error: null }
    },
    maybeSingle() {
      return { data: storedRow, error: null }
    }
  }

  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    insertedRow: () => insertedRow,
    updatedRow: () => updatedRow
  }
}

function scriptedCompletion(input: {
  finishReason: 'stop' | 'tool_calls'
  content?: string | null
  toolCallId?: string
  usage?: unknown
}): StudioModelResponse {
  return {
    id: `completion-${input.toolCallId ?? input.finishReason}`,
    object: 'chat.completion',
    created: Date.now(),
    model: 'scripted',
    choices: [{
      index: 0,
      finish_reason: input.finishReason,
      message: {
        role: 'assistant',
        content: input.content ?? null,
        tool_calls: input.toolCallId
          ? [{ id: input.toolCallId, type: 'function', function: { name: 'noop', arguments: '{}' } }]
          : undefined
      }
    }],
    usage: input.usage
  } as unknown as StudioModelResponse
}

function createNoopTool(): StudioToolDefinition {
  return {
    name: 'noop',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    description: 'Test-only no-op tool used to force a second loop step.',
    allowedAgents: ['builder'],
    execute: async () => ({ title: 'noop', output: 'ok' })
  }
}

async function createLoopFixture(input?: { tokenUsage?: StudioTokenUsage }) {
  const persistence = createInMemoryStudioPersistence()
  const session = createStudioSession({
    ownerId: 'owner-token',
    projectId: 'project-token',
    agentType: 'builder',
    title: 'Token usage test',
    directory: 'workspace-token'
  })
  const runRecord: StudioRun = {
    ...createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      inputText: 'count tokens',
      activeAgent: 'builder'
    }),
    tokenUsage: input?.tokenUsage
  }
  const assistantMessage = createStudioAssistantMessage({ sessionId: session.id, agent: 'builder' })
  await persistence.sessionStore.create(session)
  await persistence.runStore.create(runRecord)
  await persistence.messageStore.createAssistantMessage(assistantMessage)

  const registry = new StudioToolRegistry()
  for (const tool of createSharedStudioTools()) {
    registry.register(tool)
  }
  registry.register(createNoopTool())

  return { persistence, session, runRecord, assistantMessage, registry }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) {
    values.push(value)
  }
  return values
}

export async function runTokenUsageTests(): Promise<void> {
  await run('empty usage starts at zero only after the first observed invocation', async () => {
    const tracker = new StudioTokenUsageTracker()

    assert.deepEqual(tracker.current, ZERO_USAGE)
    assert.deepEqual(createEmptyStudioTokenUsage(), ZERO_USAGE)

    await tracker.trackProviderCall({
      invoke: async () => ({ usage: undefined }),
      readUsage: (response) => response.usage
    })

    assert.deepEqual(tracker.current, { ...ZERO_USAGE, unmeasuredCalls: 1 })
  })

  await run('full provider usage accumulates prompt, completion, total and measured calls', async () => {
    const call = normalizeStudioModelUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 })

    assert.deepEqual(call, { promptTokens: 10, completionTokens: 4, totalTokens: 14, measured: true })
    assert.deepEqual(accumulateStudioTokenUsage(ZERO_USAGE, call), {
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      measuredCalls: 1,
      unmeasuredCalls: 0
    })
  })

  await run('a missing total_tokens derives the call total from prompt plus completion', async () => {
    const call = normalizeStudioModelUsage({ prompt_tokens: 12, completion_tokens: 8 })

    assert.equal(call.measured, true)
    assert.equal(call.totalTokens, 20)
    // The derived total is not added on top of the parts.
    assert.deepEqual(accumulateStudioTokenUsage(ZERO_USAGE, call), {
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      measuredCalls: 1,
      unmeasuredCalls: 0
    })
  })

  await run('a successful response without usage counts one unmeasured call', async () => {
    const tracker = new StudioTokenUsageTracker()
    const checkpoints: StudioTokenUsage[] = []
    const withCheckpoint = new StudioTokenUsageTracker({ checkpoint: async (usage) => { checkpoints.push(usage) } })

    const response = await tracker.trackProviderCall({
      invoke: async () => ({ usage: null }),
      readUsage: (value) => value.usage
    })
    await withCheckpoint.trackProviderCall({
      invoke: async () => ({ usage: undefined }),
      readUsage: (value) => value.usage
    })

    assert.deepEqual(response, { usage: null })
    assert.deepEqual(tracker.current, { ...ZERO_USAGE, unmeasuredCalls: 1 })
    assert.equal(tracker.current.measuredCalls, 0)
    assert.deepEqual(checkpoints, [{ ...ZERO_USAGE, unmeasuredCalls: 1 }])
  })

  await run('a thrown provider invocation counts unmeasured and preserves the original error', async () => {
    const providerError = new Error('provider exploded')
    const tracker = new StudioTokenUsageTracker()

    await assert.rejects(
      () => tracker.trackProviderCall({
        invoke: async () => {
          throw providerError
        }
      }),
      (error: unknown) => error === providerError
    )

    assert.deepEqual(tracker.current, { ...ZERO_USAGE, unmeasuredCalls: 1 })
  })

  await run('a failing usage checkpoint never masks the provider error', async () => {
    const providerError = new Error('provider exploded')
    const checkpoints: StudioTokenUsage[] = []
    const tracker = new StudioTokenUsageTracker({
      checkpoint: async (usage) => {
        checkpoints.push(usage)
        throw new Error('run store unavailable')
      }
    })

    await assert.rejects(
      () => tracker.trackProviderCall({
        invoke: async () => {
          throw providerError
        }
      }),
      (error: unknown) => error === providerError
    )

    assert.deepEqual(checkpoints, [{ ...ZERO_USAGE, unmeasuredCalls: 1 }])
    assert.equal(tracker.current.unmeasuredCalls, 1)
  })

  await run('invalid numeric values cannot enter the aggregate', async () => {
    const malformed = normalizeStudioModelUsage({
      prompt_tokens: Number.NaN,
      completion_tokens: -3,
      total_tokens: '12'
    })
    const fractional = normalizeStudioModelUsage({ prompt_tokens: 1.5, total_tokens: Number.POSITIVE_INFINITY })
    const partiallyValid = normalizeStudioModelUsage({ prompt_tokens: 7, total_tokens: Number.NaN })

    assert.deepEqual(malformed, { promptTokens: 0, completionTokens: 0, totalTokens: 0, measured: false })
    assert.deepEqual(fractional, { promptTokens: 0, completionTokens: 0, totalTokens: 0, measured: false })
    assert.deepEqual(partiallyValid, { promptTokens: 7, completionTokens: 0, totalTokens: 7, measured: true })
    // Malformed "current" values cannot seed the aggregate either.
    assert.deepEqual(
      accumulateStudioTokenUsage(
        { promptTokens: Number.NaN, completionTokens: 0, totalTokens: 0, measuredCalls: 2, unmeasuredCalls: 0 },
        normalizeStudioModelUsage({ prompt_tokens: 5 })
      ),
      { promptTokens: 5, completionTokens: 0, totalTokens: 5, measuredCalls: 1, unmeasuredCalls: 0 }
    )
  })

  await run('a malformed direct call contribution counts unmeasured and preserves the aggregate', async () => {
    const current: StudioTokenUsage = {
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      measuredCalls: 1,
      unmeasuredCalls: 0
    }
    // Boundary test: these values are cast on purpose to model a JavaScript caller.
    const malformedCalls: unknown[] = [
      { promptTokens: Number.NaN, completionTokens: 0, totalTokens: 0, measured: true },
      { promptTokens: 1.5, completionTokens: 0, totalTokens: 1, measured: true },
      { promptTokens: -1, completionTokens: 0, totalTokens: 0, measured: true },
      { promptTokens: 1, completionTokens: 2, totalTokens: Number.POSITIVE_INFINITY, measured: true },
      { promptTokens: '1', completionTokens: 2, totalTokens: 3, measured: true },
      { promptTokens: 1, completionTokens: 2, totalTokens: 3, measured: 'yes' },
      { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      { promptTokens: 5, completionTokens: 5, totalTokens: 10, measured: false },
      null,
      'usage',
      [1, 2, 3]
    ]

    for (const call of malformedCalls) {
      const next = accumulateStudioTokenUsage(current, call as StudioCallTokenUsage)
      assert.deepEqual(next, { ...current, unmeasuredCalls: 1 })
    }

    const valid = accumulateStudioTokenUsage(current, {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      measured: true
    } as StudioCallTokenUsage)

    assert.deepEqual(valid, {
      promptTokens: 11,
      completionTokens: 6,
      totalTokens: 17,
      measuredCalls: 2,
      unmeasuredCalls: 0
    })
    // The caller's own aggregate object is never mutated.
    assert.deepEqual(current, {
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      measuredCalls: 1,
      unmeasuredCalls: 0
    })
  })

  await run('mutating the object returned by tracker.current cannot change later reads', async () => {
    const tracker = new StudioTokenUsageTracker()
    const exposed = tracker.current

    assert.deepEqual(exposed, ZERO_USAGE)
    exposed.promptTokens = Number.NaN
    exposed.completionTokens = -1
    exposed.totalTokens = Number.MAX_SAFE_INTEGER
    exposed.measuredCalls = 99
    exposed.unmeasuredCalls = 42

    assert.deepEqual(tracker.current, ZERO_USAGE)
    assert.notEqual(tracker.current, tracker.current)

    await tracker.trackProviderCall({
      invoke: async () => ({ usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }),
      readUsage: (value) => value.usage
    })

    assert.deepEqual(tracker.current, {
      promptTokens: 3,
      completionTokens: 1,
      totalTokens: 4,
      measuredCalls: 1,
      unmeasuredCalls: 0
    })
  })

  await run('a checkpoint that mutates its argument cannot change tracker state', async () => {
    const observed: StudioTokenUsage[] = []
    const tracker = new StudioTokenUsageTracker({
      checkpoint: async (usage) => {
        observed.push(usage)
        usage.promptTokens = Number.NaN
        usage.completionTokens = -100
        usage.totalTokens = -1
        usage.measuredCalls = 0
        usage.unmeasuredCalls = 0
      }
    })
    const call = async (promptTokens: number, completionTokens: number, totalTokens: number) => {
      await tracker.trackProviderCall({
        invoke: async () => ({ usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens } }),
        readUsage: (value) => value.usage
      })
    }

    await call(4, 2, 6)
    assert.deepEqual(tracker.current, {
      promptTokens: 4,
      completionTokens: 2,
      totalTokens: 6,
      measuredCalls: 1,
      unmeasuredCalls: 0
    })

    await call(1, 1, 2)
    assert.deepEqual(tracker.current, {
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
      measuredCalls: 2,
      unmeasuredCalls: 0
    })

    // The failure path hands out a copy as well, and still rethrows the provider error.
    await assert.rejects(
      () => tracker.trackProviderCall({ invoke: async () => { throw new Error('provider exploded') } }),
      (error: unknown) => (error as Error).message === 'provider exploded'
    )

    assert.deepEqual(tracker.current, {
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
      measuredCalls: 2,
      unmeasuredCalls: 1
    })
    assert.equal(observed.length, 3)
    assert.notEqual(observed[0], observed[1])
    assert.notEqual(observed[1], observed[2])
  })

  await run('multi-step Tool Loop accumulates exactly once per model invocation', async () => {
    const fixture = await createLoopFixture()
    const model = new ScriptedStudioModel([
      scriptedCompletion({
        finishReason: 'tool_calls',
        toolCallId: 'call-1',
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      }),
      scriptedCompletion({
        finishReason: 'stop',
        content: 'done',
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 }
      })
    ])
    const checkpoints: StudioTokenUsage[] = []

    await collect(createStudioOpenAIToolLoop({
      projectId: fixture.session.projectId,
      session: fixture.session,
      run: fixture.runRecord,
      assistantMessage: fixture.assistantMessage,
      inputText: fixture.runRecord.inputText,
      messageStore: fixture.persistence.messageStore,
      registry: fixture.registry,
      eventBus: new InMemoryStudioEventBus(),
      renderStore: fixture.persistence.renderStore,
      modelPort: model,
      createAssistantMessage: async () => fixture.assistantMessage,
      setToolMetadata: () => undefined,
      maxSteps: 3,
      onCheckpoint: async (patch) => {
        if (patch.tokenUsage) {
          checkpoints.push(patch.tokenUsage)
        }
      }
    }))

    assert.equal(model.requests.length, 2)
    assert.deepEqual(checkpoints.at(-1), {
      promptTokens: 130,
      completionTokens: 30,
      totalTokens: 160,
      measuredCalls: 2,
      unmeasuredCalls: 0
    })
    assert.deepEqual(checkpoints.map((usage) => usage.totalTokens), [120, 160])
  })

  await run('existing Run usage is retained and incremented', async () => {
    const priorUsage: StudioTokenUsage = {
      promptTokens: 500,
      completionTokens: 100,
      totalTokens: 600,
      measuredCalls: 4,
      unmeasuredCalls: 1
    }
    const tracker = new StudioTokenUsageTracker({ initialUsage: priorUsage })

    await tracker.trackProviderCall({
      invoke: async () => ({ usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } }),
      readUsage: (value) => value.usage
    })

    assert.deepEqual(tracker.current, {
      promptTokens: 550,
      completionTokens: 125,
      totalTokens: 675,
      measuredCalls: 5,
      unmeasuredCalls: 1
    })
    // The prior value itself is not mutated.
    assert.equal(priorUsage.totalTokens, 600)
  })

  await run('usage is checkpointed, persisted and published before later loop work', async () => {
    const fixture = await createLoopFixture()
    const eventBus = new RecordingEventBus()
    const order: string[] = []
    let callCount = 0
    const model: StudioModelPort = {
      async complete() {
        callCount += 1
        order.push(`call:${callCount}`)
        if (callCount === 1) {
          return scriptedCompletion({
            finishReason: 'tool_calls',
            toolCallId: 'call-1',
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          })
        }
        return scriptedCompletion({ finishReason: 'stop', content: 'done', usage: { total_tokens: 7 } })
      }
    }

    await collect(createStudioOpenAIToolLoop({
      projectId: fixture.session.projectId,
      session: fixture.session,
      run: fixture.runRecord,
      assistantMessage: fixture.assistantMessage,
      inputText: fixture.runRecord.inputText,
      messageStore: fixture.persistence.messageStore,
      registry: fixture.registry,
      eventBus,
      renderStore: fixture.persistence.renderStore,
      modelPort: model,
      createAssistantMessage: async () => fixture.assistantMessage,
      setToolMetadata: () => undefined,
      maxSteps: 3,
      onCheckpoint: async (patch) => {
        const nextRun = await fixture.persistence.runStore.update(
          fixture.runRecord.ownerId,
          fixture.runRecord.id,
          patch
        ) ?? { ...fixture.runRecord, ...patch }
        order.push(`checkpoint:${(nextRun.tokenUsage?.measuredCalls ?? 0) + (nextRun.tokenUsage?.unmeasuredCalls ?? 0)}`)
        eventBus.publish({ type: 'run_updated', sessionId: fixture.session.id, run: nextRun })
      }
    }))

    // The loop also checkpoints Run metadata on its own (pre-existing), so the recorded order is not
    // one entry per call. The invariant: every call is checkpointed before the next call starts, and
    // the reported usage count never regresses.
    const firstCall = order.indexOf('call:1')
    const secondCall = order.indexOf('call:2')
    assert.ok(firstCall >= 0 && secondCall > firstCall, `both model calls must run: ${order.join(',')}`)
    assert.ok(
      order.slice(firstCall, secondCall).includes('checkpoint:1'),
      `the first call must be checkpointed before the next call: ${order.join(',')}`
    )
    assert.ok(
      order.slice(secondCall).includes('checkpoint:2'),
      `the second call must be checkpointed: ${order.join(',')}`
    )
    const usageCounts = order
      .filter((entry) => entry.startsWith('checkpoint:'))
      .map((entry) => Number(entry.slice('checkpoint:'.length)))
    assert.deepEqual(
      usageCounts,
      [...usageCounts].sort((left, right) => left - right),
      `checkpointed usage must not regress: ${order.join(',')}`
    )
    const persisted = await fixture.persistence.runStore.getById(fixture.runRecord.ownerId, fixture.runRecord.id)
    assert.deepEqual(persisted?.tokenUsage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 22,
      measuredCalls: 2,
      unmeasuredCalls: 0
    })
    const runUpdates = eventBus.events.filter((event) => event.type === 'run_updated')
    // Metadata checkpoints publish `run.updated` too, so the count is not per call; the invariant is
    // that the published usage starts at call 1's total and never regresses from there.
    assert.ok(runUpdates.length >= 2, `run.updated must be published: ${runUpdates.length}`)
    const publishedTotals = runUpdates
      .map((event) => (event.type === 'run_updated' ? event.run.tokenUsage?.totalTokens : undefined))
      .filter((total): total is number => total !== undefined)
    assert.equal(publishedTotals[0], 15, 'call 1 usage is published before the second call runs')
    assert.equal(publishedTotals[publishedTotals.length - 1], 22, 'the cumulative total is published')
    assert.deepEqual(
      publishedTotals,
      [...publishedTotals].sort((left, right) => left - right),
      `published usage must not regress: ${publishedTotals.join(',')}`
    )
  })

  await run('completed, failed and cancelled runs keep the latest cumulative usage', async () => {
    const usage: StudioTokenUsage = {
      promptTokens: 40,
      completionTokens: 10,
      totalTokens: 50,
      measuredCalls: 1,
      unmeasuredCalls: 1
    }
    const runRecord = { ...createStudioRun({
      ownerId: 'owner-1',
      sessionId: 'session-1',
      inputText: 'finish',
      activeAgent: 'builder'
    }), tokenUsage: usage }

    assert.deepEqual(finalizeRunState({ run: runRecord, outcome: 'continue' }).tokenUsage, usage)
    assert.equal(finalizeRunState({ run: runRecord, outcome: 'continue' }).status, 'completed')
    assert.deepEqual(failRunState(runRecord, 'boom').tokenUsage, usage)
    assert.deepEqual(cancelRunState(runRecord, 'cancelled by user').tokenUsage, usage)
  })

  await run('Supabase run rows round-trip token usage', async () => {
    const usage: StudioTokenUsage = {
      promptTokens: 130,
      completionTokens: 30,
      totalTokens: 160,
      measuredCalls: 2,
      unmeasuredCalls: 0
    }
    const spy = createRunRowSpy()
    const persistence = createSupabaseStudioPersistence(spy.client)
    const runRecord = { ...createStudioRun({
      ownerId: 'owner-1',
      sessionId: 'session-1',
      inputText: 'round trip',
      activeAgent: 'builder'
    }), tokenUsage: usage }

    const created = await persistence.runStore.create(runRecord)
    assert.deepEqual(spy.insertedRow()?.['token_usage'], usage)
    assert.deepEqual(created.tokenUsage, usage)

    const updated = await persistence.runStore.update('owner-1', runRecord.id, {
      tokenUsage: { ...usage, totalTokens: 200 }
    })
    assert.deepEqual(spy.updatedRow()?.['token_usage'], { ...usage, totalTokens: 200 })
    assert.equal(updated?.tokenUsage?.totalTokens, 200)
  })

  await run('legacy rows without a token_usage column load with no usage', async () => {
    const legacyRow: Insertable = {
      id: 'run-legacy',
      owner_id: 'owner-1',
      session_id: 'session-1',
      status: 'completed',
      input_text: 'legacy',
      active_agent: 'builder',
      created_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      error: null,
      metadata: null
    }

    const withoutColumn = createSupabaseStudioPersistence(createRunRowSpy({ row: legacyRow }).client)
    const nullColumn = createSupabaseStudioPersistence(
      createRunRowSpy({ row: { ...legacyRow, token_usage: null } }).client
    )

    assert.equal((await withoutColumn.runStore.getById('owner-1', 'run-legacy'))?.tokenUsage, undefined)
    assert.equal((await nullColumn.runStore.getById('owner-1', 'run-legacy'))?.tokenUsage, undefined)
  })

  await run('malformed persisted usage loads safely instead of throwing', async () => {
    const baseRow: Insertable = {
      id: 'run-broken',
      owner_id: 'owner-1',
      session_id: 'session-1',
      status: 'completed',
      input_text: 'broken',
      active_agent: 'builder',
      created_at: '2026-01-01T00:00:00.000Z'
    }
    const malformedRows: Array<unknown> = [
      { promptTokens: 'many', completionTokens: 1, totalTokens: 2, measuredCalls: 1, unmeasuredCalls: 0 },
      { promptTokens: 1, completionTokens: 1, totalTokens: 2, measuredCalls: -1, unmeasuredCalls: 0 },
      JSON.parse('{"promptTokens":1e999,"completionTokens":0,"totalTokens":0,"measuredCalls":1,"unmeasuredCalls":0}'),
      'not-an-object',
      [1, 2, 3]
    ]

    for (const tokenUsage of malformedRows) {
      const persistence = createSupabaseStudioPersistence(
        createRunRowSpy({ row: { ...baseRow, token_usage: tokenUsage as Insertable } }).client
      )
      const loaded = await persistence.runStore.getById('owner-1', 'run-broken')
      assert.equal(loaded?.tokenUsage, undefined)
    }

    assert.equal(readStudioTokenUsage({ promptTokens: 1.5, completionTokens: 0, totalTokens: 0, measuredCalls: 1, unmeasuredCalls: 0 }), undefined)
    assert.deepEqual(
      readStudioTokenUsage({ promptTokens: 1, completionTokens: 2, totalTokens: 3, measuredCalls: 1, unmeasuredCalls: 0 }),
      { promptTokens: 1, completionTokens: 2, totalTokens: 3, measuredCalls: 1, unmeasuredCalls: 0 }
    )
  })

  await run('public Run DTO carries usage and strips the owner', async () => {
    const runRecord = { ...createStudioRun({
      ownerId: 'owner-1',
      sessionId: 'session-1',
      inputText: 'public',
      activeAgent: 'builder'
    }), tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, measuredCalls: 1, unmeasuredCalls: 0 } }

    const publicRun = toPublicStudioRun(runRecord)

    assert.equal('ownerId' in publicRun, false)
    assert.deepEqual(publicRun.tokenUsage, runRecord.tokenUsage)
  })

  await run('public run.updated events expose only the sanitized Run', async () => {
    const runRecord = { ...createStudioRun({
      ownerId: 'owner-secret',
      sessionId: 'session-1',
      inputText: 'public event',
      activeAgent: 'builder'
    }), tokenUsage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, measuredCalls: 1, unmeasuredCalls: 0 } }

    const event = toPublicStudioEvent({
      type: 'run.updated',
      properties: { sessionId: 'session-1', run: runRecord }
    })
    const publicRun = event.properties.run as Record<string, unknown>

    assert.equal(event.type, 'run.updated')
    assert.equal('ownerId' in publicRun, false)
    assert.deepEqual(publicRun['tokenUsage'], runRecord.tokenUsage)
    assert.equal(event.properties.sessionId, 'session-1')
    // Other events stay untouched by the run sanitizer.
    const toolEvent = toPublicStudioEvent({ type: 'tool.call', properties: { callId: 'call-1' } })
    assert.deepEqual(toolEvent.properties, { callId: 'call-1' })
  })
}
