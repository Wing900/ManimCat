import type { StudioRender } from '../domain/types'

/**
 * Render reconciliation fairness (task 11C1M review correction).
 *
 * A per-read bound keeps one Scene read cheap, but a fixed window over a creation-ordered list lets a
 * stuck prefix of `unknown` renders occupy every slot forever: the ninth render is never looked at,
 * however long the client keeps reading. The fix is a *rotating* window plus a bounded cursor.
 *
 * The cursor is an optimisation, never state: it only decides which slice of a stable candidate set a
 * read examines first. Correctness does not depend on it — a missing cursor restarts at the oldest
 * candidate, and every candidate is still examined within a bounded number of reads — so it lives in
 * process memory, is never shared through Redis, and two replicas rotating their own windows only
 * change which replica does the work, never whether a render is reconciled.
 */

/** Cursor entries kept per process. */
export const STUDIO_RENDER_RECONCILE_CURSOR_CAPACITY = 64

export interface StudioRenderReconcileCursor {
  read: (scopeKey: string) => string | null
  write: (scopeKey: string, anchor: string) => void
  clear: (scopeKey: string) => void
  size: () => number
}

/**
 * A bounded FIFO cache: one anchor render id per owner/session/scene. Re-writing a scope refreshes its
 * position; a new scope evicts the oldest entry once the capacity is reached, so a long-lived process
 * cannot accumulate anchors for Scenes nobody reads any more.
 */
export function createStudioRenderReconcileCursor(
  capacity: number = STUDIO_RENDER_RECONCILE_CURSOR_CAPACITY
): StudioRenderReconcileCursor {
  const anchors = new Map<string, string>()
  const max = Math.max(1, capacity)

  return {
    read: (scopeKey) => anchors.get(scopeKey) ?? null,
    write: (scopeKey, anchor) => {
      if (anchors.has(scopeKey)) {
        // Re-inserting moves the scope to the newest position, so FIFO eviction drops the scopes
        // that have not been read for the longest.
        anchors.delete(scopeKey)
      }
      anchors.set(scopeKey, anchor)
      while (anchors.size > max) {
        const oldest = anchors.keys().next()
        if (oldest.done) {
          break
        }
        anchors.delete(oldest.value)
      }
    },
    clear: (scopeKey) => {
      anchors.delete(scopeKey)
    },
    size: () => anchors.size
  }
}

/**
 * Scope key of one recognition: exactly the three identifiers the reconcile predicate enforces, so two
 * Scenes (or two owners) can never share a cursor. `\u0000` cannot appear inside an identifier.
 */
export function buildStudioRenderReconcileScopeKey(scope: {
  ownerId: string
  sessionId: string
  sceneId: string
}): string {
  return [scope.ownerId, scope.sessionId, scope.sceneId].join('\u0000')
}

/**
 * The stable order of the candidates: creation time, then id — the order both store implementations
 * already return. The order is *stability*, not fairness; fairness comes from moving the window.
 */
export function readStudioRenderReconcileOrder(renders: readonly StudioRender[]): StudioRender[] {
  return [...renders].sort((left, right) => {
    const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
    return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id)
  })
}

/**
 * One bounded window of the rotation: up to `limit` consecutive candidates in order, starting right
 * after `anchor` (wrapping around), or at the oldest candidate when there is no usable anchor. The
 * returned anchor is the id of the last candidate of the window, so the next read continues where this
 * one stopped and a stuck prefix cannot hold the whole window forever. Candidates outside the window
 * keep their backlog; a newcomer is reached within `ceil(size / limit)` reads, which is the honest
 * cost of the bound rather than a claim of instant fairness.
 */
export function readStudioRenderReconcileWindow(
  ordered: readonly StudioRender[],
  anchor: string | null,
  limit: number
): { window: StudioRender[]; anchor: string | null } {
  if (!ordered.length || limit <= 0) {
    return { window: [], anchor: null }
  }

  const size = Math.min(limit, ordered.length)
  const start = readStudioRenderReconcileStart(ordered, anchor)
  const window: StudioRender[] = []
  for (let offset = 0; offset < size; offset += 1) {
    window.push(ordered[(start + offset) % ordered.length] as StudioRender)
  }
  return { window, anchor: window[window.length - 1]?.id ?? null }
}

/** Index the window starts at: right after the anchor, or at the oldest candidate without one. */
function readStudioRenderReconcileStart(ordered: readonly StudioRender[], anchor: string | null): number {
  if (anchor === null) {
    return 0
  }
  const index = ordered.findIndex((render) => render.id === anchor)
  // An unknown anchor — a render that finished, or a restarted process — restarts at the oldest.
  return index < 0 ? 0 : (index + 1) % ordered.length
}
