import { getSupabaseClient } from '../../database/client'
import { isStudioDatabaseReady } from '../../database/config'
import { createLogger } from '../../utils/logger'
import { createInMemoryStudioPersistence } from './in-memory-studio-persistence'
import { createSupabaseStudioPersistence } from './supabase-studio-persistence'
import type { StudioPersistence } from './studio-persistence'

const logger = createLogger('StudioPersistence')

export function createDefaultStudioPersistence(): StudioPersistence {
  if (!isStudioDatabaseReady()) {
    logger.info('Studio persistence provider: in-memory')
    return createInMemoryStudioPersistence()
  }

  const client = getSupabaseClient()
  if (!client) {
    logger.warn('Studio DB requested but Supabase client is unavailable, falling back to in-memory persistence')
    return createInMemoryStudioPersistence()
  }

  logger.info('Studio persistence provider: supabase')
  return createSupabaseStudioPersistence(client)
}
