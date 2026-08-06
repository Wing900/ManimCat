import type { StudioRender, StudioRun, StudioSession } from './core-types'
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

export interface StudioRunStore {
  create: (run: StudioRun) => Promise<StudioRun>
  getById: (ownerId: string, runId: string) => Promise<StudioRun | null>
  update: (ownerId: string, runId: string, patch: Partial<StudioRun>) => Promise<StudioRun | null>
  listBySessionId: (ownerId: string, sessionId: string) => Promise<StudioRun[]>
}

export interface StudioRenderStore {
  create: (render: StudioRender) => Promise<StudioRender>
  getById: (ownerId: string, renderId: string) => Promise<StudioRender | null>
  update: (ownerId: string, renderId: string, patch: Partial<StudioRender>) => Promise<StudioRender | null>
  listBySessionId: (ownerId: string, sessionId: string) => Promise<StudioRender[]>
}
