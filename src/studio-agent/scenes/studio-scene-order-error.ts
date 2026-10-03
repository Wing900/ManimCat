/**
 * Reasons a Scene order submission is rejected by a store. The vocabulary is shared by the
 * in-memory and Supabase adapters so both surface identical observable behavior.
 *
 * `missing_scene` deliberately covers "does not exist" and "belongs to another owner": the
 * caller must not learn that a foreign Scene exists.
 */
export type StudioSceneOrderRejection =
  | 'empty_order'
  | 'duplicate_scene'
  | 'missing_scene'
  | 'foreign_scene'
  | 'incomplete_set'

export class StudioSceneOrderRejectedError extends Error {
  readonly reason: StudioSceneOrderRejection

  constructor(reason: StudioSceneOrderRejection) {
    super(`Studio scene order rejected: ${reason}`)
    this.name = 'StudioSceneOrderRejectedError'
    this.reason = reason
  }
}
