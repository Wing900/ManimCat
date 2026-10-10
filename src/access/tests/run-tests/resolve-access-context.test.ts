import assert from 'node:assert/strict'
import type { CustomApiConfig } from '../../../types'
import { resolveAccessContext } from '../../application/resolve-access-context'
import { deriveOwnerId, hashCatKey } from '../../domain/credentials'
import { createCatKeyRecord, createFakeCatKeyRepository, rejects, run } from '../support/fakes'

const SERVER_UPSTREAM: CustomApiConfig = {
  apiUrl: 'https://server.example.com/v1',
  apiKey: 'server-secret',
  model: 'deepseek-flash'
}

const BROWSER_CONFIG: CustomApiConfig = {
  apiUrl: 'https://browser.example.com/v1',
  apiKey: 'sk-browser',
  model: 'gpt-4o-mini'
}

function catKeyCredential(suffix = 'a'): string {
  return `mc_${suffix.repeat(64)}`
}

function browserSecretCredential(suffix = 'b'): string {
  return `byok_${suffix.repeat(64)}`
}

/** Deps whose CatKey lookup always finds the given record. */
function depsWith(
  record = createCatKeyRecord({ keyHash: hashCatKey(catKeyCredential()) }),
  options: { noUpstream?: boolean } = {}
) {
  const catKeys = createFakeCatKeyRepository([record])
  return {
    catKeys,
    deps: {
      catKeyRepository: catKeys.repository,
      // Explicit option rather than a default parameter: `depsWith(record, undefined)` would
      // silently restore the default and the "no upstream" case would never be exercised.
      readCatKeyUpstreamConfig: () => (options.noUpstream ? undefined : SERVER_UPSTREAM)
    }
  }
}

export async function runResolveAccessContextTests(): Promise<void> {
  await run('an active CatKey resolves to the server upstream', async () => {
    const credential = catKeyCredential()
    const record = createCatKeyRecord({ keyHash: hashCatKey(credential) })
    const { catKeys, deps } = depsWith(record)

    const context = await resolveAccessContext({ credential }, deps)

    assert.equal(context.mode, 'catkey')
    assert.equal(context.mode === 'catkey' && context.catKeyId, record.id)
    assert.deepEqual(context.providerConfig, SERVER_UPSTREAM)
    assert.equal(context.ownerId, deriveOwnerId(credential))
    // The lookup must go through the hash: the plaintext never reaches the database.
    assert.deepEqual(catKeys.queriedHashes, [hashCatKey(credential)])
  })

  await run('an unknown CatKey is rejected', async () => {
    const { deps } = depsWith(createCatKeyRecord({ keyHash: hashCatKey(catKeyCredential('f')) }))

    const error = await rejects(() => resolveAccessContext({ credential: catKeyCredential() }, deps), 'AuthenticationError')

    assert.equal(error.message, '无效的 API 密钥')
  })

  await run('a revoked CatKey is rejected even though the row exists', async () => {
    const credential = catKeyCredential()
    const record = createCatKeyRecord({ keyHash: hashCatKey(credential), status: 'revoked' })
    const { deps } = depsWith(record)

    const error = await rejects(() => resolveAccessContext({ credential }, deps), 'AuthenticationError')

    assert.equal(error.message, '该 CatKey 已被停用')
  })

  await run('a CatKey request cannot override the server upstream from its body', async () => {
    const credential = catKeyCredential()
    const record = createCatKeyRecord({ keyHash: hashCatKey(credential) })
    const { deps } = depsWith(record)

    const context = await resolveAccessContext(
      { credential, requestProviderConfig: BROWSER_CONFIG },
      deps
    )

    assert.deepEqual(
      context.providerConfig,
      SERVER_UPSTREAM,
      'the browser-supplied config must be ignored outright in CatKey mode'
    )
  })

  await run('a CatKey whose deployment has no upstream configured fails as unavailable', async () => {
    const credential = catKeyCredential()
    const record = createCatKeyRecord({ keyHash: hashCatKey(credential) })
    const { deps } = depsWith(record, { noUpstream: true })

    const error = await rejects(() => resolveAccessContext({ credential }, deps), 'ServiceUnavailableError')

    assert.equal(
      error.message,
      '服务端未配置 CatKey 上游，请设置 CATKEY_UPSTREAM_URL 与 CATKEY_UPSTREAM_API_KEY'
    )
  })

  await run('a complete BYOK config resolves to the browser upstream without touching the database', async () => {
    const credential = browserSecretCredential()
    const { catKeys, deps } = depsWith()

    const context = await resolveAccessContext({ credential, requestProviderConfig: BROWSER_CONFIG }, deps)

    assert.equal(context.mode, 'byok')
    assert.deepEqual(context.providerConfig, BROWSER_CONFIG)
    assert.equal(context.ownerId, deriveOwnerId(credential))
    assert.deepEqual(catKeys.queriedHashes, [], 'a browser secret must never reach the CatKey table')
  })

  await run('a BYOK request with no provider config still authenticates', async () => {
    // Job status, cancel and Studio reads carry the browser secret alone; they still need an owner.
    const { deps } = depsWith()

    const context = await resolveAccessContext({ credential: browserSecretCredential() }, deps)

    assert.equal(context.mode, 'byok')
    assert.equal(context.providerConfig, undefined)
  })

  await run('a half-filled BYOK config reads as absent instead of failing the request', async () => {
    const { deps } = depsWith()

    const context = await resolveAccessContext(
      { credential: browserSecretCredential(), requestProviderConfig: { apiUrl: 'https://x/v1', apiKey: '', model: 'm' } },
      deps
    )

    assert.equal(context.providerConfig, undefined)
  })

  await run('BYOK config fields are trimmed', async () => {
    const { deps } = depsWith()

    const context = await resolveAccessContext(
      {
        credential: browserSecretCredential(),
        requestProviderConfig: { apiUrl: '  https://x/v1  ', apiKey: '  sk-x  ', model: '  m  ' }
      },
      deps
    )

    assert.deepEqual(context.providerConfig, { apiUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' })
  })

  await run('a declared mode that contradicts the credential is refused', async () => {
    const { deps } = depsWith()

    const catKey = await rejects(
      () => resolveAccessContext({ credential: catKeyCredential(), declaredMode: 'byok' }, deps),
      'AuthenticationError'
    )
    const browser = await rejects(
      () => resolveAccessContext({ credential: browserSecretCredential(), declaredMode: 'catkey' }, deps),
      'AuthenticationError'
    )

    assert.equal(catKey.message, '连接模式与凭据不符：声明为 byok，凭据实际为 catkey')
    assert.equal(browser.message, '连接模式与凭据不符：声明为 catkey，凭据实际为 byok')
  })

  await run('a matching declared mode is accepted', async () => {
    const credential = catKeyCredential()
    const { deps } = depsWith(createCatKeyRecord({ keyHash: hashCatKey(credential) }))

    const context = await resolveAccessContext({ credential, declaredMode: 'catkey' }, deps)

    assert.equal(context.mode, 'catkey')
  })

  await run('a missing credential is rejected before any lookup', async () => {
    const { catKeys, deps } = depsWith()

    const error = await rejects(() => resolveAccessContext({ credential: '   ' }, deps), 'AuthenticationError')

    assert.equal(error.message, '缺少 API 密钥。请在 Authorization 头中提供 Bearer 令牌。')
    assert.deepEqual(catKeys.queriedHashes, [])
  })

  await run('an unrecognized credential shape is rejected before any lookup', async () => {
    const { catKeys, deps } = depsWith()

    // The shape that used to be accepted: an arbitrary operator-chosen string.
    const error = await rejects(() => resolveAccessContext({ credential: 'demo-key' }, deps), 'AuthenticationError')

    assert.match(error.message, /无法识别的 API 密钥格式/)
    assert.deepEqual(catKeys.queriedHashes, [])
  })

  await run('an uppercase CatKey is rejected on shape, not looked up', async () => {
    const { catKeys, deps } = depsWith()

    await rejects(() => resolveAccessContext({ credential: `mc_${'A'.repeat(64)}` }, deps), 'AuthenticationError')

    assert.deepEqual(catKeys.queriedHashes, [])
  })
}
