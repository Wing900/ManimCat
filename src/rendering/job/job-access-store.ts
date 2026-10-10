import crypto from 'crypto'
import { redisClient, REDIS_KEYS, generateRedisKey } from '../../infrastructure/redis/config'
import { ForbiddenError } from '../../shared/errors/errors'

const JOB_ACCESS_KEY_PREFIX = `${REDIS_KEYS.JOB_ACCESS}`
const DEFAULT_RETENTION_HOURS = 24

interface StoredJobAccessRecord {
  ownerIdHash: string
  clientId?: string
  createdAt: number
}

interface StoreJobAccessInput {
  jobId: string
  ownerId: string
  clientId?: string
}

interface AssertJobAccessInput {
  jobId: string
  ownerId: string
  clientId?: string
}

function getRetentionSeconds(): number {
  const raw = Number(process.env.JOB_RESULT_RETENTION_HOURS)
  const hours = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RETENTION_HOURS
  return hours * 60 * 60
}

/**
 * Job ownership is keyed on the AccessContext owner id, not on the raw credential: a Route no
 * longer holds the credential, and the owner id is already a hash. Hashing it once more keeps the
 * stored record opaque to anyone reading Redis directly.
 */
function hashOwnerId(ownerId: string): string {
  return crypto.createHash('sha256').update(ownerId).digest('hex')
}

export async function storeJobAccess(input: StoreJobAccessInput): Promise<void> {
  const key = generateRedisKey(JOB_ACCESS_KEY_PREFIX, input.jobId)
  const payload: StoredJobAccessRecord = {
    ownerIdHash: hashOwnerId(input.ownerId),
    clientId: input.clientId?.trim() || undefined,
    createdAt: Date.now(),
  }

  await redisClient.set(key, JSON.stringify(payload))
  await redisClient.expire(key, getRetentionSeconds())
}

export async function assertJobAccess(input: AssertJobAccessInput): Promise<void> {
  const key = generateRedisKey(JOB_ACCESS_KEY_PREFIX, input.jobId)
  const raw = await redisClient.get(key)
  if (!raw) {
    throw new ForbiddenError('当前任务不属于这个客户端或已不可访问')
  }

  let record: StoredJobAccessRecord
  try {
    record = JSON.parse(raw) as StoredJobAccessRecord
  } catch {
    throw new ForbiddenError('当前任务的访问元数据无效')
  }

  if (record.ownerIdHash !== hashOwnerId(input.ownerId)) {
    throw new ForbiddenError('当前任务不属于这个访问身份')
  }

  const expectedClientId = record.clientId?.trim()
  if (expectedClientId && expectedClientId !== (input.clientId?.trim() || '')) {
    throw new ForbiddenError('当前任务不属于这个浏览器客户端')
  }
}

export async function getJobAccessCreatedAt(jobId: string): Promise<number | null> {
  const key = generateRedisKey(JOB_ACCESS_KEY_PREFIX, jobId)
  const raw = await redisClient.get(key)
  if (!raw) {
    return null
  }

  try {
    const record = JSON.parse(raw) as StoredJobAccessRecord
    return typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : null
  } catch {
    return null
  }
}

export async function deleteJobAccess(jobId: string): Promise<void> {
  await redisClient.del(generateRedisKey(JOB_ACCESS_KEY_PREFIX, jobId))
}
