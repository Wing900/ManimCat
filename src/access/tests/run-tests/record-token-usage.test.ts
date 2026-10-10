import assert from 'node:assert/strict'
import { createTokenUsageRecorder } from '../../application/record-token-usage'
import { createFakeCatKeyRepository, createFakeUsageRepository, run } from '../support/fakes'

const CAT_KEY_ID = '11111111-1111-4111-8111-111111111111'

const TOTALS = {
  promptTokens: 120,
  completionTokens: 30,
  totalTokens: 150,
  measuredCalls: 2,
  unmeasuredCalls: 1
}

export async function runRecordTokenUsageTests(): Promise<void> {
  await run('a BYOK call writes nothing and never reaches for the repositories', async () => {
    const usage = createFakeUsageRepository()
    const catKeys = createFakeCatKeyRepository()
    let dependencyRequests = 0

    const recordTokenUsage = createTokenUsageRecorder(() => {
      dependencyRequests += 1
      return { usageRepository: usage.repository, catKeyRepository: catKeys.repository }
    })

    await recordTokenUsage({
      catKeyId: undefined,
      model: 'gpt-4o-mini',
      sourceKind: 'studio_run',
      sourceId: 'run-1',
      totals: TOTALS
    })

    assert.deepEqual(usage.upserts, [], 'BYOK usage is billed by the user, never metered here')
    assert.deepEqual(catKeys.touches, [])
    assert.equal(
      dependencyRequests,
      0,
      'a Supabase-less BYOK deployment must not be asked for a client at all'
    )
  })

  await run('a CatKey call upserts one row carrying the id, the source and the totals', async () => {
    const usage = createFakeUsageRepository()
    const catKeys = createFakeCatKeyRepository()
    const recordTokenUsage = createTokenUsageRecorder(() => ({
      usageRepository: usage.repository,
      catKeyRepository: catKeys.repository
    }))

    await recordTokenUsage({
      catKeyId: CAT_KEY_ID,
      model: 'deepseek-flash',
      sourceKind: 'workflow_job',
      sourceId: 'job-7',
      totals: TOTALS
    })

    assert.equal(usage.upserts.length, 1)
    assert.deepEqual(usage.upserts[0].record, {
      catKeyId: CAT_KEY_ID,
      sourceKind: 'workflow_job',
      sourceId: 'job-7',
      model: 'deepseek-flash',
      ...TOTALS
    })
  })

  await run('the same instant is used for the usage row and for last_used_at', async () => {
    const usage = createFakeUsageRepository()
    const catKeys = createFakeCatKeyRepository()
    const recordTokenUsage = createTokenUsageRecorder(() => ({
      usageRepository: usage.repository,
      catKeyRepository: catKeys.repository
    }))

    await recordTokenUsage({
      catKeyId: CAT_KEY_ID,
      model: 'deepseek-flash',
      sourceKind: 'studio_run',
      sourceId: 'run-3',
      totals: TOTALS
    })

    assert.equal(catKeys.touches.length, 1)
    assert.equal(catKeys.touches[0].catKeyId, CAT_KEY_ID)
    assert.equal(
      catKeys.touches[0].usedAt.getTime(),
      usage.upserts[0].recordedAt.getTime(),
      'reading two different clocks would let the ledger and the registry disagree'
    )
  })

  await run('a checkpoint for the same source overwrites rather than accumulates', async () => {
    const usage = createFakeUsageRepository()
    const catKeys = createFakeCatKeyRepository()
    const recordTokenUsage = createTokenUsageRecorder(() => ({
      usageRepository: usage.repository,
      catKeyRepository: catKeys.repository
    }))

    const input = {
      catKeyId: CAT_KEY_ID,
      model: 'deepseek-flash',
      sourceKind: 'studio_run' as const,
      sourceId: 'run-9'
    }

    await recordTokenUsage({ ...input, totals: { ...TOTALS, totalTokens: 150 } })
    await recordTokenUsage({ ...input, totals: { ...TOTALS, totalTokens: 400 } })

    assert.equal(usage.upserts.length, 2, 'both checkpoints are written')
    assert.equal(usage.upserts[0].record.totalTokens, 150)
    assert.equal(
      usage.upserts[1].record.totalTokens,
      400,
      'the second value is the cumulative one, so the row is overwritten, not summed'
    )
    assert.equal(usage.upserts[0].record.sourceId, usage.upserts[1].record.sourceId)
  })

  await run('a failing ledger write never fails the run that already succeeded', async () => {
    const usage = createFakeUsageRepository({ failWith: new Error('supabase is unreachable') })
    const catKeys = createFakeCatKeyRepository()
    const recordTokenUsage = createTokenUsageRecorder(() => ({
      usageRepository: usage.repository,
      catKeyRepository: catKeys.repository
    }))

    await recordTokenUsage({
      catKeyId: CAT_KEY_ID,
      model: 'deepseek-flash',
      sourceKind: 'workflow_job',
      sourceId: 'job-11',
      totals: TOTALS
    })

    assert.deepEqual(catKeys.touches, [], 'a failed write must not still stamp last_used_at')
  })

  await run('a repository that cannot be built is logged, not thrown', async () => {
    const recordTokenUsage = createTokenUsageRecorder(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
    })

    await recordTokenUsage({
      catKeyId: CAT_KEY_ID,
      model: 'deepseek-flash',
      sourceKind: 'workflow_job',
      sourceId: 'job-12',
      totals: TOTALS
    })
  })
}
