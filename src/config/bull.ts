import { default as Bull, type Queue, type QueueOptions } from 'bull'
import Redis from 'ioredis'
import { REDIS_KEYS } from './redis'
import { createLogger } from '../shared/logging/logger'
import { terminateManimProcess } from '../utils/manim-process-registry'

const logger = createLogger('BullQueue')

const queueOptions: QueueOptions = {
  prefix: REDIS_KEYS.QUEUE_PREFIX,
  createClient: (_type) => {
    const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
    const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10)
    const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined
    const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10)

    const client = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })

    return client
  },
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: true,
    removeOnFail: true,
    timeout: 1200000
  },
  settings: {
    lockDuration: 1200000,
    stalledInterval: 30000,
    maxStalledCount: 1
  }
}

export const videoQueue: Queue = new Bull('video-generation', queueOptions)

async function inspectExistingJobs() {
  try {
    await videoQueue.isReady()

    const stats = await getQueueStats()
    logger.info('Startup queue inspection', stats)
  } catch (error: any) {
    logger.warn('Startup queue inspection warning', { error: error?.message || String(error) })
  }
}

inspectExistingJobs()

videoQueue.on('error', (error) => {
  logger.error('Queue error', { message: error.message })
})

videoQueue.on('waiting', (jobId) => {
  logger.debug(`Job ${jobId} is waiting`)
})

videoQueue.on('active', (job) => {
  logger.info(`Job ${job.id} started processing`)
})

videoQueue.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`)
})

videoQueue.on('failed', (job, err) => {
  const jobId = typeof job?.id === 'string' ? job.id : String(job?.id || '')
  const terminated = jobId ? terminateManimProcess(jobId) : false
  logger.error(`Job ${job?.id} failed`, { message: err.message })
  if (terminated) {
    logger.warn(`Job ${job?.id} failure cleanup terminated active Manim process`, {
      reason: err.message
    })
  }
})

videoQueue.on('progress', (job, progress) => {
  logger.debug(`Job ${job.id} progress: ${progress}%`)
})

videoQueue.on('stalled', (job) => {
  logger.warn(`Job ${job.id} stalled`)
})

export async function cleanQueue(): Promise<void> {
  await videoQueue.clean(0, 'completed')
  await videoQueue.clean(0, 'failed')
  logger.info('Queue cleaned')
}

export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    videoQueue.getWaitingCount(),
    videoQueue.getActiveCount(),
    videoQueue.getCompletedCount(),
    videoQueue.getFailedCount(),
    videoQueue.getDelayedCount()
  ])

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed
  }
}

export async function checkQueueHealth(): Promise<boolean> {
  try {
    await videoQueue.isReady()
    await videoQueue.getJobCounts()
    return true
  } catch (error) {
    logger.warn('Queue health check failed', { error: String(error) })
    return false
  }
}

export async function closeQueue(): Promise<void> {
  await videoQueue.close()
  logger.info('Queue connection closed')
}
