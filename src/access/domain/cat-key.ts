export type CatKeyStatus = 'active' | 'revoked'

/** One row of `cat_keys`. The plaintext key is not part of this record and never can be. */
export interface CatKeyRecord {
  readonly id: string
  readonly keyHash: string
  readonly keyPrefix: string
  readonly label: string | null
  readonly status: CatKeyStatus
  readonly createdAt: string
  readonly lastUsedAt: string | null
}
