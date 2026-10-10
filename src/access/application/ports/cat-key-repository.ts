import type { CatKeyRecord } from '../../domain/cat-key'

/** Read side of the CatKey registry. Writes happen only through the SQL Editor's issue function. */
export interface CatKeyRepository {
  findByHash(keyHash: string): Promise<CatKeyRecord | undefined>
  touchLastUsedAt(catKeyId: string, usedAt: Date): Promise<void>
}
