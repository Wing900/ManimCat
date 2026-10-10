import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudioScene, StudioSceneStore } from '../../domain/types'
import type { StudioSceneRow } from './supabase-persistence-shared'
import { TABLES } from './supabase-persistence-shared'
import {
  StudioSceneOrderRejectedError,
  type StudioSceneOrderRejection,
} from '../../scenes/studio-scene-order-error'

export function createSupabaseStudioSceneStore(client: SupabaseClient): StudioSceneStore {
  return {
    async create(scene) {
      const { data, error } = await client.from(TABLES.scenes).insert(toSceneRow(scene)).select('*').single()
      if (error) throw new Error(`[StudioDB] Failed to create scene: ${error.message}`)
      return fromSceneRow(data as StudioSceneRow)
    },
    async append(scene) {
      // One round trip: the function takes a per-Session advisory lock, picks the next position
      // and inserts, so two concurrent creators can never persist the same position.
      const { data, error } = await client.rpc('studio_scene_append', {
        p_id: scene.id,
        p_owner_id: scene.ownerId,
        p_session_id: scene.sessionId,
        p_source_path: scene.sourcePath,
        p_created_at: scene.createdAt,
        p_updated_at: scene.updatedAt,
      })
      if (error) throw new Error(`[StudioDB] Failed to append scene: ${error.message}`)
      const stored = ((data ?? []) as StudioSceneRow[])[0]
      if (!stored) throw new Error('[StudioDB] Failed to append scene: no row returned')
      return fromSceneRow(stored)
    },
    async getById(ownerId, sceneId) {
      const { data, error } = await client
        .from(TABLES.scenes)
        .select('*')
        .eq('id', sceneId)
        .eq('owner_id', ownerId)
        .maybeSingle()
      if (error) throw new Error(`[StudioDB] Failed to get scene: ${error.message}`)
      return data ? fromSceneRow(data as StudioSceneRow) : null
    },
    async listBySessionId(ownerId, sessionId) {
      const { data, error } = await client
        .from(TABLES.scenes)
        .select('*')
        .eq('owner_id', ownerId)
        .eq('session_id', sessionId)
        .order('position', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw new Error(`[StudioDB] Failed to list scenes: ${error.message}`)
      return (data ?? []).map((row) => fromSceneRow(row as StudioSceneRow))
    },
    async replaceOrder(ownerId, sessionId, orderedSceneIds) {
      const { data, error } = await client.rpc('studio_scene_replace_order', {
        p_owner_id: ownerId,
        p_session_id: sessionId,
        p_scene_ids: [...orderedSceneIds],
      })
      if (error) {
        const rejection = readStudioSceneOrderRejection(error)
        if (rejection) {
          throw new StudioSceneOrderRejectedError(rejection)
        }
        throw new Error(`[StudioDB] Failed to replace scene order: ${error.message}`)
      }
      return ((data ?? []) as StudioSceneRow[]).map((row) => fromSceneRow(row))
    },
  }
}

/**
 * `studio_scene_replace_order` raises SQLSTATE `P0003`/`P0004` for a rejected order; everything
 * else is an infrastructure failure and must not be reported as a caller mistake.
 */
function readStudioSceneOrderRejection(error: { code?: string }): StudioSceneOrderRejection | null {
  if (error.code === 'P0003') {
    return 'empty_order'
  }
  if (error.code === 'P0004') {
    return 'incomplete_set'
  }
  return null
}
function toSceneRow(scene: StudioScene): StudioSceneRow {
  return {
    id: scene.id,
    owner_id: scene.ownerId,
    session_id: scene.sessionId,
    position: scene.position,
    source_path: scene.sourcePath,
    created_at: scene.createdAt,
    updated_at: scene.updatedAt,
  }
}
function fromSceneRow(row: StudioSceneRow): StudioScene {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    position: row.position,
    sourcePath: row.source_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
