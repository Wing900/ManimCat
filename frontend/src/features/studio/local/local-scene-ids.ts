/**
 * Scene ids in the local store: `scene_1`, `scene_2`, ...
 *
 * The id is the Python module stem other Scenes import, so it has to be a Python identifier and it
 * must never change. A number is minted once, at birth, and never handed out again: reordering
 * rewrites only `position`, and a retired number stays retired so an old import can never silently
 * resolve to a different Scene.
 *
 * Scope is one Session. The local store keys Scenes by `[sessionId, id]`, so two Sessions may both
 * own a `scene_1`. Global uniqueness was the server-side store's constraint, and that store is
 * going away.
 */

/** First number of a Session. Counting starts at one: `scene_1`, `scene_2`, ... */
export const LOCAL_SCENE_SLOT_MIN = 1

export function formatLocalSceneId(slot: number): string {
  return `scene_${slot}`
}

/** Number encoded in a Scene id, or null when the id is not a numbered Scene id. */
export function readLocalSceneSlot(sceneId: string): number | null {
  const match = /^scene_(\d+)$/.exec(sceneId)
  if (!match) {
    return null
  }

  const slot = Number(match[1])
  return Number.isSafeInteger(slot) && slot >= LOCAL_SCENE_SLOT_MIN ? slot : null
}

/**
 * The next Scene id for a Session: one past the highest number in use.
 *
 * Highest rather than count, so removing a middle Scene never frees its number for a newcomer. Ids
 * that are not numbered Scenes contribute nothing and are never reused.
 */
export function nextLocalSceneId(existingIds: Iterable<string>): string {
  const taken = new Set(existingIds)
  let slot = LOCAL_SCENE_SLOT_MIN
  for (const id of taken) {
    const parsed = readLocalSceneSlot(id)
    if (parsed !== null && parsed >= slot) {
      slot = parsed + 1
    }
  }

  while (taken.has(formatLocalSceneId(slot))) {
    slot += 1
  }

  return formatLocalSceneId(slot)
}

/**
 * Line-initial `from scene_N import ...` names, which is what the Scene template emits.
 *
 * A commented-out import sits behind a `#`, so it never starts a line with `from` and is not read.
 * Returns sorted, de-duplicated ids so the result is stable for hashing.
 */
export function readLocalSceneImports(code: string): string[] {
  const found = new Set<string>()
  for (const match of code.matchAll(/^[ \t]*from[ \t]+(scene_\d+)[ \t]+import\b/gm)) {
    found.add(match[1])
  }
  return [...found].sort()
}
