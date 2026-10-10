/**
 * Scene freshness and Recycle Bin numbering — the pure decisions of the local store.
 *
 * Kept free of IndexedDB so they can be tested directly; the store layer only persists their results.
 */

import { hashLocalText } from './local-hash'
import { readLocalSceneImports } from './local-scene-ids'

/**
 * What the user should be told about a Scene's video:
 *
 * - `UNRENDERED` no video yet (covers "never rendered" and "the video was replaced by unrendered
 *   code", which are the same next action: render)
 * - `READY`     the video matches the current code and every upstream Scene
 * - `DIRTY`     this Scene's own code changed after the video was made
 * - `STALE`     an upstream Scene changed, so this video may be out of date (yellow light)
 */
export type LocalSceneFreshness = 'UNRENDERED' | 'READY' | 'DIRTY' | 'STALE'

/** The hash snapshot taken when a Scene was rendered. `null` means no video is on the table. */
export interface LocalRenderFingerprint {
  codeHash: string
  /** upstream sceneId -> that Scene's code hash at render time. */
  upstreamHashes: Record<string, string>
}

export interface LocalSceneFreshnessInput {
  code: string
  /** Current code of every other Scene in the Session, by id. */
  sceneCodes: Record<string, string | undefined>
  rendered: LocalRenderFingerprint | null
}

export function hashLocalSceneUpstreams(
  code: string,
  sceneCodes: Record<string, string | undefined>,
): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const sceneId of readLocalSceneImports(code)) {
    const upstreamCode = sceneCodes[sceneId]
    if (upstreamCode !== undefined) {
      hashes[sceneId] = hashLocalText(upstreamCode)
    }
  }
  return hashes
}

export function readLocalSceneFreshness(input: LocalSceneFreshnessInput): LocalSceneFreshness {
  if (!input.rendered) {
    return 'UNRENDERED'
  }

  if (hashLocalText(input.code) !== input.rendered.codeHash) {
    return 'DIRTY'
  }

  const currentUpstreams = hashLocalSceneUpstreams(input.code, input.sceneCodes)
  if (!sameHashRecord(currentUpstreams, input.rendered.upstreamHashes)) {
    return 'STALE'
  }

  return 'READY'
}

function sameHashRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false
    }
  }

  return true
}

/**
 * Recycle Bin numbering: one past the highest number in the bin.
 *
 * Versions are never reused within a bin, and an emptied bin starts again at 1. Highest rather than
 * count, so removing an entry from the middle never frees its number for a newcomer.
 */
export function nextLocalTrashId(existingIds: Iterable<number>): number {
  let highest = 0
  for (const id of existingIds) {
    if (Number.isSafeInteger(id) && id > highest) {
      highest = id
    }
  }
  return highest + 1
}
