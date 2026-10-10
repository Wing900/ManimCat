/**
 * FNV-1a 32-bit over UTF-16 code units.
 *
 * Synchronous and dependency-free, which is all the local store needs: the hash answers "did this
 * change?" It is not a security primitive, so a non-cryptographic digest is the right tool — Web
 * Crypto would force every freshness check to become async for no benefit.
 */
export function hashLocalText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
