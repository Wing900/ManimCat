import { createHash } from 'node:crypto'

/**
 * How a raw bearer credential is recognised and reduced to a stable owner.
 *
 * Exactly two shapes are accepted, and nothing else:
 *
 *     mc_<64 hex>      CatKey          minted by the maintainer, verified against Supabase
 *     byok_<64 hex>    Browser secret  generated when the browser first picks BYOK
 *
 * The owner id is derived from the credential itself, never from the CatKey row, and the
 * derivation is byte-identical to the one Studio used before this module existed
 * (`sha256(token).slice(0, 32)`). Keeping it identical is what lets Sessions written under the
 * previous environment-array arrangement stay reachable to a user who keeps the same key.
 */

const CAT_KEY_PATTERN = /^mc_[0-9a-f]{64}$/
const BROWSER_SECRET_PATTERN = /^byok_[0-9a-f]{64}$/

export function isCatKeyCredential(credential: string): boolean {
  return CAT_KEY_PATTERN.test(credential)
}

export function isBrowserSecretCredential(credential: string): boolean {
  return BROWSER_SECRET_PATTERN.test(credential)
}

/**
 * The stored value of a CatKey. The plaintext never reaches the database, a log line, or an
 * error message.
 */
export function hashCatKey(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

export function deriveOwnerId(credential: string): string {
  return createHash('sha256').update(credential.trim()).digest('hex').slice(0, 32)
}
