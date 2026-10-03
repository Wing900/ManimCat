import { StudioApiRequestError } from '../../api/client'
import type { StudioRequestOptions } from '../../api/studio-agent-api'
import type {
  StudioCreateSessionInput,
  StudioKind,
  StudioSession,
  StudioSessionSnapshot,
} from '../../protocol/studio-agent-types'

/**
 * Session identity for the Cinema UI (task 11C2).
 *
 * The Cinema UI cannot mount the legacy `useStudioSession`: that hook owns the Session SSE stream and
 * the legacy Run submission, which a Scene-scoped UI must not start. What is genuinely needed is much
 * narrower — decide *which* Session this workspace talks to (restore a reachable one, or create one on
 * an explicit user action) and hand that identity to the Scene controller, which owns everything else
 * (opening, the Scene index, Scene streams).
 *
 * Rules this layer encodes:
 *
 * - the recent list keeps its order when the user picks an entry, so a click is always visible where it
 *   happened; only creating or auto-restoring a Session moves it to the front;
 * - the local recent-id list is the only history the client has, so it is never silently discarded:
 *   a transport failure keeps it and asks the user, and only a definite `NOT_FOUND` answer (the
 *   Session is gone for this owner) removes one entry;
 * - one intent produces at most one Session. A repeated call with the same signature joins the running
 *   workflow, which is what makes a StrictMode effect replay create exactly one Session;
 * - `generation` makes a response that belongs to a superseded intent unwritable, so a late restore can
 *   never replace a Session the user already chose;
 * - a failure never invents a Session id: `unavailable` says what is unknown and lets the UI decide.
 */

export interface StudioCinemaSessionGatewayApi {
  createSession: (input: StudioCreateSessionInput) => Promise<StudioSession>
  getSessionSnapshot: (sessionId: string, options?: StudioRequestOptions) => Promise<StudioSessionSnapshot>
}

export interface StudioCinemaSessionGatewayStorage {
  readLastSessionId: (studioKind: string) => string | null
  readRecentSessionIds: (studioKind: string) => string[]
  rememberSessionId: (studioKind: string, sessionId: string) => void
  /**
   * Records a Session as the last used one *without* touching the recent order. Picking an entry in the
   * list must not reshuffle it: the list is the only map the user has, and reordering moves the clicked
   * entry out from under the pointer, which reads as "the click did nothing".
   */
  markLastSessionId: (studioKind: string, sessionId: string) => void
  forgetSessionId: (studioKind: string, sessionId: string) => void
}

export interface StudioCinemaSessionGatewayDependencies {
  api: StudioCinemaSessionGatewayApi
  storage: StudioCinemaSessionGatewayStorage
  createAbortController: () => AbortController
  /**
   * Ownership of the resolution (correction R5). It answers "does the caller that started this
   * workflow still exist?" — a real unmount says no, while a StrictMode effect replay says yes again,
   * because the same binding is re-attached. A workflow that is no longer owned resolves as `stale`
   * and writes no history, so a response cannot outlive the screen that asked for it.
   *
   * It deliberately does not abort an in-flight create: a request that already left cannot be
   * revoked, and cancelling it would risk orphaning a Session the server may have created.
   */
  isOwned?: () => boolean
  /** Project of a new Session. The Studio flow has no per-Session Project choice yet. */
  projectId: string
  /** Title given to a newly created Session. */
  defaultTitle: string
}

export type StudioCinemaSessionFailureReason =
  | 'restore_unavailable'
  | 'restore_missing'
  | 'create_failed'
  | 'create_unknown'

export type StudioCinemaSessionOutcome =
  | { status: 'ready'; origin: 'restored' | 'created'; session: StudioSession }
  | { status: 'unavailable'; reason: StudioCinemaSessionFailureReason; sessionId: string | null }
  | { status: 'stale' }

interface StudioCinemaSessionWorkflow {
  signature: string
  promise: Promise<StudioCinemaSessionOutcome>
}

type StudioCinemaSessionRead =
  | { status: 'ready'; session: StudioSession }
  | { status: 'missing' }
  | { status: 'unavailable' }
  | { status: 'stale' }

/** Mirrors the accepted Scene-controller policy: only a transport failure leaves an outcome unknown. */
function classifyStudioCinemaSessionError(error: unknown): 'not_found' | 'definite' | 'unknown' {
  if (error instanceof StudioApiRequestError) {
    if (error.code === 'NOT_FOUND') {
      return 'not_found'
    }
    if (error.code === 'STUDIO_REQUEST_FAILED') {
      // The response could not be read as a Studio envelope: the server may still have applied it.
      return 'unknown'
    }
    return 'definite'
  }
  return 'unknown'
}

/**
 * Restore candidates in priority order: the last used Session first, then the rest of the recent
 * list, without duplicates. An empty list means "no history", which is the only case where the flow
 * creates a Session without asking.
 */
export function readStudioCinemaSessionCandidates(
  storage: StudioCinemaSessionGatewayStorage,
  studioKind: string
): string[] {
  const last = storage.readLastSessionId(studioKind)
  const recent = storage.readRecentSessionIds(studioKind)
  const ordered = last ? [last, ...recent] : recent
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const sessionId of ordered) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || seen.has(sessionId)) {
      continue
    }
    seen.add(sessionId)
    candidates.push(sessionId)
  }
  return candidates
}

export class StudioCinemaSessionGateway {
  private readonly deps: StudioCinemaSessionGatewayDependencies
  private generation = 0
  private abort: AbortController
  private workflow: StudioCinemaSessionWorkflow | null = null

  constructor(deps: StudioCinemaSessionGatewayDependencies) {
    this.deps = deps
    this.abort = deps.createAbortController()
  }

  /** False when the caller that started the running workflow is gone. */
  private isOwned(): boolean {
    return this.deps.isOwned?.() !== false
  }

  /**
   * Restores the most recent reachable Session, or creates one when there is no history at all. A
   * repeated call joins the workflow already running for that intent.
   */
  open(studioKind: StudioKind): Promise<StudioCinemaSessionOutcome> {
    return this.run(studioKind, 'restore')
  }

  /** Explicit "new Session": never restores, so a user action cannot silently reuse an old one. */
  createNew(studioKind: StudioKind): Promise<StudioCinemaSessionOutcome> {
    return this.run(studioKind, 'create')
  }

  /**
   * Explicit restore of one history entry (the Session list). It never falls back to creating a
   * Session: picking an entry that turns out to be gone must not silently start a new one.
   */
  restore(studioKind: StudioKind, sessionId: string): Promise<StudioCinemaSessionOutcome> {
    return this.run(studioKind, 'restore', sessionId)
  }

  /**
   * Removes one history entry. Only a definite `NOT_FOUND` answer may reach this, and only a live
   * owner may write: this is the one public write, so it carries the same ownership gate as every
   * internal write (correction F2). Returns whether the entry was actually forgotten, so a caller
   * cannot believe a write happened that the gate refused.
   */
  forget(studioKind: StudioKind, sessionId: string): boolean {
    if (!this.isOwned()) {
      return false
    }
    this.deps.storage.forgetSessionId(studioKind, sessionId)
    return true
  }

  /**
   * Invalidates the running workflow and aborts its reads: a response that arrives afterwards is
   * stale and can no longer be applied. The gateway stays usable.
   */
  invalidate(): void {
    this.generation += 1
    this.workflow = null
    this.abort.abort()
    this.abort = this.deps.createAbortController()
  }

  private run(
    studioKind: StudioKind,
    origin: 'restore' | 'create',
    sessionId?: string
  ): Promise<StudioCinemaSessionOutcome> {
    const signature = `${studioKind}:${origin}:${sessionId ?? ''}`
    if (!this.isOwned()) {
      // An unowned intent does not even leave the client: no request, no storage write.
      return Promise.resolve({ status: 'stale' })
    }
    const running = this.workflow
    if (running && running.signature === signature) {
      return running.promise
    }

    this.generation += 1
    const generation = this.generation
    this.abort.abort()
    this.abort = this.deps.createAbortController()

    const started =
      origin === 'create'
        ? this.createSession(studioKind, generation)
        : this.restoreOrCreate(studioKind, generation, sessionId)

    let entry: StudioCinemaSessionWorkflow
    const tracked = started.finally(() => {
      if (this.workflow === entry) {
        this.workflow = null
      }
    })
    entry = { signature, promise: tracked }
    this.workflow = entry
    return tracked
  }

  private async restoreOrCreate(
    studioKind: StudioKind,
    generation: number,
    explicitSessionId?: string
  ): Promise<StudioCinemaSessionOutcome> {
    if (explicitSessionId) {
      const read = await this.readSession(explicitSessionId, generation)
      if (read.status === 'stale') {
        return { status: 'stale' }
      }
      if (read.status === 'ready') {
        if (!this.isOwned()) {
          return { status: 'stale' }
        }
        // The explicit pick moves the last-used pointer only: the recent list keeps its order, so the
        // entry the user just clicked stays exactly where they clicked it.
        this.deps.storage.markLastSessionId(studioKind, explicitSessionId)
        return { status: 'ready', origin: 'restored', session: read.session }
      }
      if (read.status === 'missing') {
        // A definite 404 for an explicitly picked entry: forget it, and do not quietly create another
        // Session in its place.
        if (!this.isOwned()) {
          return { status: 'stale' }
        }
        this.deps.storage.forgetSessionId(studioKind, explicitSessionId)
        return { status: 'unavailable', reason: 'restore_missing', sessionId: explicitSessionId }
      }
      return { status: 'unavailable', reason: 'restore_unavailable', sessionId: explicitSessionId }
    }

    const candidates = readStudioCinemaSessionCandidates(this.deps.storage, studioKind)

    for (const sessionId of candidates) {
      const read = await this.readSession(sessionId, generation)
      if (read.status === 'stale') {
        return { status: 'stale' }
      }
      // Ownership checkpoint between candidates: a detached binding abandons the sweep at the next
      // boundary instead of continuing to read (and write) for a screen that is gone.
      if (!this.isOwned()) {
        return { status: 'stale' }
      }
      if (read.status === 'ready') {
        this.deps.storage.rememberSessionId(studioKind, sessionId)
        return { status: 'ready', origin: 'restored', session: read.session }
      }
      if (read.status === 'missing') {
        // Definite answer: this Session is not reachable for this owner any more. Forget the entry and
        // try the next candidate instead of retrying a dead id forever.
        this.deps.storage.forgetSessionId(studioKind, sessionId)
        continue
      }
      // No answer at all: the history stays intact and the user decides whether to retry or to start a
      // new Session. A temporary outage must never look like "this Session never existed".
      return { status: 'unavailable', reason: 'restore_unavailable', sessionId }
    }

    return this.createSession(studioKind, generation)
  }

  private async readSession(sessionId: string, generation: number): Promise<StudioCinemaSessionRead> {
    try {
      const snapshot = await this.deps.api.getSessionSnapshot(sessionId, { signal: this.abort.signal })
      if (generation !== this.generation || !this.isOwned()) {
        return { status: 'stale' }
      }
      return { status: 'ready', session: snapshot.session }
    } catch (error) {
      if (generation !== this.generation || !this.isOwned()) {
        return { status: 'stale' }
      }
      return classifyStudioCinemaSessionError(error) === 'not_found'
        ? { status: 'missing' }
        : { status: 'unavailable' }
    }
  }

  private async createSession(
    studioKind: StudioKind,
    generation: number
  ): Promise<StudioCinemaSessionOutcome> {
    try {
      const session = await this.deps.api.createSession({
        projectId: this.deps.projectId,
        title: this.deps.defaultTitle,
        studioKind,
        agentType: 'builder',
      })
      if (generation !== this.generation || !this.isOwned()) {
        // A create that already left the client cannot be revoked: the Session may exist on the
        // server, so the outcome stays unknown for this caller and no history is written for a screen
        // that is gone. This is deliberately not a claim of exactly-once creation.
        return { status: 'stale' }
      }
      this.deps.storage.rememberSessionId(studioKind, session.id)
      return { status: 'ready', origin: 'created', session }
    } catch (error) {
      // The same ownership + intent gate as the success path: a detached caller learns nothing about
      // a create it can no longer apply (correction F2).
      if (generation !== this.generation || !this.isOwned()) {
        return { status: 'stale' }
      }
      // A definite server answer means no Session was created; anything else leaves the outcome
      // unknown, and the UI says so instead of pretending the Session exists (or does not).
      return classifyStudioCinemaSessionError(error) === 'definite'
        ? { status: 'unavailable', reason: 'create_failed', sessionId: null }
        : { status: 'unavailable', reason: 'create_unknown', sessionId: null }
    }
  }
}
