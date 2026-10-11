import { getSupabaseClient } from '../../../infrastructure/database/client'
import { isStudioDatabaseReady } from '../../../infrastructure/database/config'
import { isStudioClientDataMode } from '../../../config/studio-data-mode'
import { createLogger } from '../../../shared/logging/logger'
import { createInMemoryStudioPersistence } from './in-memory-studio-persistence'
import { createSupabaseStudioPersistence } from './supabase-studio-persistence'
import type { StudioPersistence } from './studio-persistence'

const logger = createLogger('StudioPersistence')

export function createDefaultStudioPersistence(): StudioPersistence {
  if (isStudioClientDataMode()) {
    // The whole point of the client shape: nothing a user typed is written here. In-memory is not a
    // fallback, it is the contract — a restart must leave no Session row behind.
    logger.info('Studio persistence provider: in-memory (STUDIO_DATA_MODE=client)')
    return createInMemoryStudioPersistence()
  }

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
