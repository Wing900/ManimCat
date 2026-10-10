/**
 * Transport-neutral admission scope and its canonical key helpers.
 *
 * This module is the single authority on what "the same scope" means: the in-memory adapter,
 * the Redis adapter and the coordination service all derive their keys from here, so a
 * Session-exclusive Legacy holder and one Scene holder per Scene can never disagree about
 * identity. It deliberately imports nothing from the coordination modules, which keeps the
 * dependency graph acyclic (`coordinator -> scope`, `codec -> scope`).
 */

/**
 * Transport-neutral admission scope. A Legacy Run takes the whole Session exclusively; a Scene
 * Run takes one Scene exclusively while sharing the Session with its siblings.
 */
export type StudioRunCoordinationScope =
  | { kind: 'legacy-session'; sessionId: string }
  | { kind: 'scene'; sessionId: string; sceneId: string }

export interface StudioRunLease {
  /** The complete scope the lease was acquired for; compared whole on renew and release. */
  scope: StudioRunCoordinationScope
  leaseId: string
  ownerInstanceId: string
  /** Absolute epoch milliseconds at which the lease stops being valid. */
  expiresAt: number
}

/** Versioned admission namespace: Task 11B2A changes the schema, so mixed replicas must not mix. */
export const STUDIO_RUN_ADMISSION_NAMESPACE = 'admission:v2'
/** Hash field of the Session-exclusive Legacy holder. */
export const STUDIO_RUN_LEGACY_SCOPE_FIELD = 'legacy'
export const STUDIO_RUN_MAX_NAME_LENGTH = 200

/** Escapes anything outside `[A-Za-z0-9_-]`, so a raw identifier can never shape a key. */
export function encodeStudioRunKeySegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > STUDIO_RUN_MAX_NAME_LENGTH) {
    throw new Error(`Studio Run coordination identifiers must be 1-${STUDIO_RUN_MAX_NAME_LENGTH} characters`)
  }
  return trimmed.replace(/[^A-Za-z0-9_-]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

/**
 * Canonical, transport-safe scope identity: `legacy:<encoded-session>` or
 * `scene:<encoded-session>:<encoded-scene>`. One pure helper, so the local registry, the
 * admission fields and the specs can never disagree about what "the same scope" means.
 */
export function canonicalStudioRunScopeKey(scope: StudioRunCoordinationScope): string {
  assertStudioRunScope(scope)
  if (scope.kind === 'legacy-session') {
    return `legacy:${encodeStudioRunKeySegment(scope.sessionId)}`
  }
  return `scene:${encodeStudioRunKeySegment(scope.sessionId)}:${encodeStudioRunKeySegment(scope.sceneId)}`
}

/** Admission HASH field for a scope: `legacy` or `scene:<encoded-scene>`. */
export function studioRunScopeAdmissionField(scope: StudioRunCoordinationScope): string {
  return scope.kind === 'legacy-session'
    ? STUDIO_RUN_LEGACY_SCOPE_FIELD
    : `scene:${encodeStudioRunKeySegment(scope.sceneId)}`
}

export function createLegacyStudioRunScope(sessionId: string): StudioRunCoordinationScope {
  const scope: StudioRunCoordinationScope = { kind: 'legacy-session', sessionId }
  assertStudioRunScope(scope)
  return scope
}

export function createSceneStudioRunScope(sessionId: string, sceneId: string): StudioRunCoordinationScope {
  const scope: StudioRunCoordinationScope = { kind: 'scene', sessionId, sceneId }
  assertStudioRunScope(scope)
  return scope
}

/** Rejects anything that could not be turned into a bounded, unambiguous admission field. */
export function assertStudioRunScope(scope: StudioRunCoordinationScope): void {
  encodeStudioRunKeySegment(scope.sessionId)
  if (scope.kind === 'scene') {
    encodeStudioRunKeySegment(scope.sceneId)
  }
}

/** The whole scope plus the fencing token; never compared by a subset. */
export function serializeStudioRunLeaseToken(lease: StudioRunLease): string {
  // Ordered array so the comparison never depends on object key ordering.
  return JSON.stringify([
    lease.scope.kind,
    lease.scope.sessionId,
    lease.scope.kind === 'scene' ? lease.scope.sceneId : '',
    lease.ownerInstanceId,
    lease.leaseId
  ])
}
