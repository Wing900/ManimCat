import type { CatKeyRepository } from '../application/ports/cat-key-repository'
import type { CatKeyRecord } from '../domain/cat-key'

/**
 * How long one resolved CatKey may be trusted before the registry is asked again.
 *
 * Keys are issued and revoked by hand (the repository's own port documents writes as SQL-Editor
 * only), so this window *is* the revocation latency: a CatKey switched to `revoked` keeps working
 * until the entry that remembered it expires. Five minutes is the default because it already removes
 * the registry lookup from the hot path while keeping a manual revocation from lasting long enough to
 * be forgotten; `CATKEY_CACHE_TTL_SECONDS` overrides it, and restarting the server clears it.
 */
export const DEFAULT_CAT_KEY_CACHE_TTL_MS = 5 * 60 * 1000

/** Reads the configured window, falling back to the default for anything unusable. */
export function readCatKeyCacheTtlMs(raw: string | undefined = process.env.CATKEY_CACHE_TTL_SECONDS): number {
  if (!raw || !raw.trim()) {
    return DEFAULT_CAT_KEY_CACHE_TTL_MS
  }

  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_CAT_KEY_CACHE_TTL_MS
  }

  return seconds * 1000
}

/**
 * Caches the CatKey registry lookup, which is otherwise one Supabase round trip on every request
 * that carries a CatKey.
 *
 * Only a *found* key is remembered. Caching a miss would make a freshly issued key fail until its
 * entry expired, and there is nothing about a key that does not exist worth remembering.
 * `touchLastUsedAt` stays a straight pass-through: it is bookkeeping, not a decision, so it neither
 * reads nor invalidates this cache.
 */
export function createCachedCatKeyRepository(
  repository: CatKeyRepository,
  options: { ttlMs?: number; now?: () => number } = {},
): CatKeyRepository {
  const ttlMs = options.ttlMs ?? readCatKeyCacheTtlMs()
  const now = options.now ?? (() => Date.now())
  const resolved = new Map<string, { record: CatKeyRecord; expiresAt: number }>()

  return {
    async findByHash(keyHash: string): Promise<CatKeyRecord | undefined> {
      const current = now()
      const remembered = resolved.get(keyHash)
      if (remembered && remembered.expiresAt > current) {
        return remembered.record
      }

      const record = await repository.findByHash(keyHash)
      if (record) {
        resolved.set(keyHash, { record, expiresAt: current + ttlMs })
      } else {
        resolved.delete(keyHash)
      }
      return record
    },

    touchLastUsedAt: (catKeyId, usedAt) => repository.touchLastUsedAt(catKeyId, usedAt),
  }
}
