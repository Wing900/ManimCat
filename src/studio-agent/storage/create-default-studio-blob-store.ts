import { getSupabaseClient } from '../../database/client'
import { isStudioDatabaseReady } from '../../database/config'
import { createLogger } from '../../utils/logger'
import { createLocalStudioBlobStore } from './local-studio-blob-store'
import { createSupabaseStudioBlobStore } from './supabase-studio-blob-store'
import type { StudioBlobStore } from './studio-blob-store'

const logger = createLogger('StudioBlobStore')

export function createDefaultStudioBlobStore(): StudioBlobStore {
  const bucket = process.env.STUDIO_BLOB_BUCKET?.trim()

  if (!isStudioDatabaseReady() || !bucket) {
    logger.info('Studio blob store provider: local')
    return createLocalStudioBlobStore()
  }

  const client = getSupabaseClient()
  if (!client) {
    logger.warn('Studio blob store requested but Supabase client is unavailable, falling back to local blob store')
    return createLocalStudioBlobStore()
  }

  logger.info('Studio blob store provider: supabase')
  return createSupabaseStudioBlobStore({ client, bucket })
}
