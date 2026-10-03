import type {
  StudioRender,
  StudioRenderStatus,
  StudioRun,
  StudioRunStatus,
  StudioScene,
  StudioSession,
} from './core-types'
import type {
  StudioAssistantMessage,
  StudioMessage,
  StudioMessagePart,
  StudioUserMessage
} from './message-types'

export interface StudioSessionStore {
  create: (session: StudioSession) => Promise<StudioSession>
  getById: (ownerId: string, sessionId: string) => Promise<StudioSession | null>
  update: (ownerId: string, sessionId: string, patch: Partial<StudioSession>) => Promise<StudioSession | null>
  listChildren: (ownerId: string, parentSessionId: string) => Promise<StudioSession[]>
}

export interface StudioMessageStore {
  createAssistantMessage: (message: StudioAssistantMessage) => Promise<StudioAssistantMessage>
  createUserMessage: (message: StudioUserMessage) => Promise<StudioUserMessage>
  getById: (messageId: string) => Promise<StudioMessage | null>
  listBySessionId: (sessionId: string) => Promise<StudioMessage[]>
  /**
   * Exact Scene matches only, ordered by `createdAt` then `id`. Legacy records without a Scene
   * scope are excluded; `listBySessionId` keeps returning both legacy and Scene-scoped rows.
   */
  listBySceneId: (sceneId: string) => Promise<StudioMessage[]>
  updateAssistantMessage: (
    messageId: string,
    patch: Partial<Omit<StudioAssistantMessage, 'id' | 'sessionId' | 'role'>>
  ) => Promise<StudioAssistantMessage | null>
}

export interface StudioPartStore {
  create: (part: StudioMessagePart) => Promise<StudioMessagePart>
  update: (partId: string, patch: Partial<StudioMessagePart>) => Promise<StudioMessagePart | null>
  getById: (partId: string) => Promise<StudioMessagePart | null>
  listByMessageId: (messageId: string) => Promise<StudioMessagePart[]>
}

export interface StudioRunTransitionInput {
  ownerId: string
  runId: string
  /** Expected current statuses; the transition only applies while the Run is still one of them. */
  from: readonly StudioRunStatus[]
  patch: Partial<StudioRun> & { status: StudioRunStatus }
}

export interface StudioRunTransitionResult {
  /** `false` means the conditional update lost the race; `run` is then the persisted winner. */
  applied: boolean
  run: StudioRun | null
}

export interface StudioRunStore {
  create: (run: StudioRun) => Promise<StudioRun>
  getById: (ownerId: string, runId: string) => Promise<StudioRun | null>
  update: (ownerId: string, runId: string, patch: Partial<StudioRun>) => Promise<StudioRun | null>
  /**
   * Atomic terminal transition: applies `patch` only while the stored status is in `from`.
   * Backends must express the predicate in the write itself (never read-then-write), so a
   * late `completed` cannot overwrite a `cancelled` Run.
   */
  transitionStatus: (input: StudioRunTransitionInput) => Promise<StudioRunTransitionResult>
  listBySessionId: (ownerId: string, sessionId: string) => Promise<StudioRun[]>
  /**
   * Runs of exactly this Scene and owner, ordered by `createdAt` then `id`. Legacy Runs without a
   * Scene scope are excluded; `listBySessionId` keeps returning both legacy and Scene-scoped Runs.
   */
  listBySceneId: (ownerId: string, sceneId: string) => Promise<StudioRun[]>
}

export interface StudioRenderTransitionInput {
  ownerId: string
  renderId: string
  /** Expected current statuses; the transition only applies while the stored status is one of them. */
  from: readonly StudioRenderStatus[]
  /**
   * Expected persisted job id. The predicate binds one job result to the render that points at it,
   * so a result can never be written onto a render whose job id has changed.
   */
  expectedJobId?: string
  patch: Partial<StudioRender> & { status: StudioRenderStatus }
}

export interface StudioRenderTransitionResult {
  /** `false` means the conditional update lost the race; `render` is then the persisted winner. */
  applied: boolean
  render: StudioRender | null
}

export interface StudioRenderStore {
  create: (render: StudioRender) => Promise<StudioRender>
  getById: (ownerId: string, renderId: string) => Promise<StudioRender | null>
  update: (ownerId: string, renderId: string, patch: Partial<StudioRender>) => Promise<StudioRender | null>
  /**
   * Conditional transition: applies `patch` only while the stored status is in `from` (and the
   * persisted job id is `expectedJobId` when given). Backends must express the predicate in the
   * write itself — never read-then-write — so a late `running` observation cannot overwrite a
   * `completed` render, and two replicas racing a completion cannot both win.
   */
  transitionStatus: (input: StudioRenderTransitionInput) => Promise<StudioRenderTransitionResult>
  listBySessionId: (ownerId: string, sessionId: string) => Promise<StudioRender[]>
  /**
   * Renders of exactly this Scene and owner, ordered by `createdAt` then `id`. Legacy renders
   * without a Scene scope are excluded.
   */
  listBySceneId: (ownerId: string, sceneId: string) => Promise<StudioRender[]>
}

/** A Scene record before its store assigns the position. */
export type StudioSceneAppendInput = Omit<StudioScene, 'position'>

export interface StudioSceneStore {
  /** Persists the record at exactly the stated position; duplicate positions are rejected. */
  create: (scene: StudioScene) => Promise<StudioScene>
  /**
   * Atomic append: persists the record at the next free position of its Session and returns
   * the stored record. Implementations must serialize concurrent appends per Session so two
   * creators can never persist the same position.
   */
  append: (scene: StudioSceneAppendInput) => Promise<StudioScene>
  getById: (ownerId: string, sceneId: string) => Promise<StudioScene | null>
  /** Scenes of one Session, ordered by `position` then `id` as the deterministic tie-breaker. */
  listBySessionId: (ownerId: string, sessionId: string) => Promise<StudioScene[]>
  /**
   * Atomic order replacement for one Session: the submitted list must be the exact persisted
   * Scene set, positions become contiguous `0..n-1`, and no intermediate duplicate position is
   * ever observable. Rejections throw `StudioSceneOrderRejectedError`.
   */
  replaceOrder: (
    ownerId: string,
    sessionId: string,
    orderedSceneIds: readonly string[]
  ) => Promise<StudioScene[]>
}
