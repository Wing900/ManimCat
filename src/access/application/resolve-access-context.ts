import type { CustomApiConfig } from '../../types'
import { AuthenticationError, ServiceUnavailableError } from '../../shared/errors/errors'
import { createLogger } from '../../shared/logging/logger'
import type { AccessContext, ConnectionMode } from '../domain/access-context'
import {
  deriveOwnerId,
  hashCatKey,
  isBrowserSecretCredential,
  isCatKeyCredential
} from '../domain/credentials'
import type { CatKeyRepository } from './ports/cat-key-repository'

const logger = createLogger('AccessResolver')

export interface ResolveAccessContextInput {
  /** Raw Bearer token, with the `Bearer ` prefix already stripped. */
  credential: string
  /** `X-ManimCat-Connection`, when the client sent one. Advisory: the credential decides. */
  declaredMode?: string
  /** `providerConfig` from the request body. Read in BYOK mode only. */
  requestProviderConfig?: CustomApiConfig
}

export interface ResolveAccessContextDeps {
  catKeyRepository: CatKeyRepository
  readCatKeyUpstreamConfig: () => CustomApiConfig | undefined
}

/**
 * Turns one request's credential into the single AccessContext every protected Route consumes.
 *
 * The credential's shape is authoritative and the declared mode is only cross-checked: a client
 * that announces one mode while carrying the other's credential is a client bug, and failing
 * loudly is cheaper than silently serving the wrong upstream.
 */
export async function resolveAccessContext(
  input: ResolveAccessContextInput,
  deps: ResolveAccessContextDeps
): Promise<AccessContext> {
  const credential = input.credential.trim()

  if (!credential) {
    throw new AuthenticationError('缺少 API 密钥。请在 Authorization 头中提供 Bearer 令牌。')
  }

  if (isCatKeyCredential(credential)) {
    return resolveCatKeyAccess(credential, input.declaredMode, input.requestProviderConfig, deps)
  }

  if (isBrowserSecretCredential(credential)) {
    return resolveByokAccess(credential, input.declaredMode, input.requestProviderConfig)
  }

  throw new AuthenticationError('无法识别的 API 密钥格式：CatKey 形如 mc_…，本地 BYOK 标识形如 byok_…')
}

async function resolveCatKeyAccess(
  credential: string,
  declaredMode: string | undefined,
  requestProviderConfig: CustomApiConfig | undefined,
  deps: ResolveAccessContextDeps
): Promise<AccessContext> {
  assertDeclaredModeMatches(declaredMode, 'catkey')

  const record = await deps.catKeyRepository.findByHash(hashCatKey(credential))
  if (!record) {
    throw new AuthenticationError('无效的 API 密钥')
  }
  if (record.status === 'revoked') {
    throw new AuthenticationError('该 CatKey 已被停用')
  }

  if (requestProviderConfig) {
    logger.warn('CatKey 请求携带了 providerConfig，已忽略：CatKey 的模型由服务端固定', {
      catKeyPrefix: record.keyPrefix
    })
  }

  const providerConfig = deps.readCatKeyUpstreamConfig()
  if (!providerConfig) {
    throw new ServiceUnavailableError(
      '服务端未配置 CatKey 上游，请设置 CATKEY_UPSTREAM_URL 与 CATKEY_UPSTREAM_API_KEY'
    )
  }

  return {
    mode: 'catkey',
    ownerId: deriveOwnerId(credential),
    catKeyId: record.id,
    providerConfig
  }
}

function resolveByokAccess(
  credential: string,
  declaredMode: string | undefined,
  requestProviderConfig: CustomApiConfig | undefined
): AccessContext {
  assertDeclaredModeMatches(declaredMode, 'byok')

  return {
    mode: 'byok',
    ownerId: deriveOwnerId(credential),
    providerConfig: readOptionalProviderConfig(requestProviderConfig)
  }
}

function assertDeclaredModeMatches(declaredMode: string | undefined, actual: ConnectionMode): void {
  if (!declaredMode || declaredMode === actual) {
    return
  }

  throw new AuthenticationError(`连接模式与凭据不符：声明为 ${declaredMode}，凭据实际为 ${actual}`)
}

/**
 * A BYOK request may carry no provider config at all (status polls, cancels, reads), or carry one
 * that the browser left half-filled. Both read as "no config here"; the Routes that actually need
 * a model call `requireProviderConfig`, which raises the error at the point where it is true.
 */
function readOptionalProviderConfig(config: CustomApiConfig | undefined): CustomApiConfig | undefined {
  if (!config) {
    return undefined
  }

  const apiUrl = config.apiUrl?.trim() ?? ''
  const apiKey = config.apiKey?.trim() ?? ''
  const model = config.model?.trim() ?? ''

  if (!apiUrl || !apiKey || !model) {
    return undefined
  }

  return { apiUrl, apiKey, model }
}
