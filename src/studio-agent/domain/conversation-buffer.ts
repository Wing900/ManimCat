import type { StudioMessage } from './message-types'

export interface StudioConversationScope {
  sessionId: string
  sceneId?: string
}

/** Live conversation lifetime belongs to the Run, never to an HTTP/SSE connection. */
export interface StudioConversationBuffer {
  begin: (scope: StudioConversationScope) => Promise<void>
  flush: (scope: StudioConversationScope) => Promise<void>
}

export type StudioConversationWriter = (messages: readonly StudioMessage[]) => Promise<void>
