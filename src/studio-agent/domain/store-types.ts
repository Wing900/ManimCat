import type { StudioRender, StudioRun, StudioRunStatus, StudioSession } from './core-types'
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
}

export interface StudioRenderStore {
  create: (render: StudioRender) => Promise<StudioRender>
  getById: (ownerId: string, renderId: string) => Promise<StudioRender | null>
  update: (ownerId: string, renderId: string, patch: Partial<StudioRender>) => Promise<StudioRender | null>
  listBySessionId: (ownerId: string, sessionId: string) => Promise<StudioRender[]>
}
