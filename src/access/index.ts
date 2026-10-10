/**
 * Access 模块出口。
 *
 * 对外只暴露两件事：把一次请求解析成 `AccessContext`，以及把一次 Job/Run 的用量落库。
 * 领域类型与端口保持可导入，供测试用假仓储替换。
 */

import { ServiceUnavailableError } from '../shared/errors/errors'
import { getSupabaseClient } from '../infrastructure/database/client'
import type { CatKeyRepository } from './application/ports/cat-key-repository'
import type { UsageRepository } from './application/ports/usage-repository'
import {
  resolveAccessContext,
  type ResolveAccessContextInput
} from './application/resolve-access-context'
import {
  createTokenUsageRecorder,
  type RecordTokenUsageInput
} from './application/record-token-usage'
import { readCatKeyUpstreamConfig } from './infrastructure/catkey-upstream-config'
import { createSupabaseCatKeyRepository } from './infrastructure/supabase/supabase-cat-key-repository'
import { createSupabaseUsageRepository } from './infrastructure/supabase/supabase-usage-repository'
import type { AccessContext } from './domain/access-context'

export type { AccessContext, ByokAccessContext, CatKeyAccessContext, ConnectionMode } from './domain/access-context'
export { requireProviderConfig } from './domain/access-context'
export type { CatKeyRecord, CatKeyStatus } from './domain/cat-key'
export type { TokenUsageTotals, UsageRecordInput, UsageSourceKind } from './domain/usage-record'
export type { ResolveAccessContextInput } from './application/resolve-access-context'
export type { RecordTokenUsageInput } from './application/record-token-usage'
export type { CatKeyRepository } from './application/ports/cat-key-repository'
export type { UsageRepository } from './application/ports/usage-repository'
export { resolveAccessContext, createTokenUsageRecorder }
export { verifyConnection, type ConnectionProbe, type VerifyConnectionResult } from './application/verify-connection'
export { readCatKeyUpstreamConfig }

interface AccessRepositories {
  catKeyRepository: CatKeyRepository
  usageRepository: UsageRepository
}

let repositories: AccessRepositories | null = null

/**
 * The Supabase client is optional at boot (a BYOK-only deployment never configures one), so it is
 * resolved on first CatKey use rather than at import time.
 */
function requireSupabaseRepositories(): AccessRepositories {
  if (repositories) {
    return repositories
  }

  const client = getSupabaseClient()
  if (!client) {
    throw new ServiceUnavailableError(
      '服务端未配置 Supabase，无法校验 CatKey：请设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  repositories = {
    catKeyRepository: createSupabaseCatKeyRepository(client),
    usageRepository: createSupabaseUsageRepository(client)
  }

  return repositories
}

export function resolveRequestAccessContext(input: ResolveAccessContextInput): Promise<AccessContext> {
  return resolveAccessContext(input, {
    catKeyRepository: requireSupabaseRepositories().catKeyRepository,
    readCatKeyUpstreamConfig
  })
}

let tokenUsageRecorder: ReturnType<typeof createTokenUsageRecorder> | null = null

export function recordTokenUsage(input: RecordTokenUsageInput): Promise<void> {
  if (!tokenUsageRecorder) {
    tokenUsageRecorder = createTokenUsageRecorder(requireSupabaseRepositories)
  }

  return tokenUsageRecorder(input)
}
