import crypto from 'crypto'
import { redisClient, REDIS_KEYS, generateRedisKey } from '../config/redis'
import { ForbiddenError } from '../utils/errors'

const JOB_ACCESS_KEY_PREFIX = `${REDIS_KEYS.JOB_ACCESS}`
const DEFAULT_RETENTION_HOURS = 24

interface StoredJobAccessRecord {
  apiKeyHash: string
  clientId?: string
  createdAt: number
}

interface StoreJobAccessInput {
  jobId: string
  apiKey: string
  clientId?: string
}

interface AssertJobAccessInput {
  jobId: string
  apiKey: string
  clientId?: string
}

function getRetentionSeconds(): number {
  const raw = Number(process.env.JOB_RESULT_RETENTION_HOURS)
  const hours = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RETENTION_HOURS
  return hours * 60 * 60
}

function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex')
}

export async function storeJobAccess(input: StoreJobAccessInput): Promise<void> {
  const key = generateRedisKey(JOB_ACCESS_KEY_PREFIX, input.jobId)
  const payload: StoredJobAccessRecord = {
    apiKeyHash: hashApiKey(input.apiKey),
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

  if (record.apiKeyHash !== hashApiKey(input.apiKey)) {
    throw new ForbiddenError('当前任务不属于这个 API key')
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
