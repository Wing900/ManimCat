import { describe, expect, it } from 'vitest'
import { createStudioViewSelectors } from './studio-selectors'
import { createInitialStudioState } from './studio-session-store'
import type { StudioAssistantMessage, StudioSession } from '../protocol/studio-agent-types'

describe('createStudioViewSelectors', () => {
  it('preserves the messages array reference when unrelated state changes do not touch messages', () => {
    const selectors = createStudioViewSelectors()
    const session = createSession()
    const assistantMessage = createAssistantMessage()

    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        messagesById: {
          [assistantMessage.id]: assistantMessage,
        },
        messageOrder: [assistantMessage.id],
      },
    }

    const first = selectors.selectStudioMessages(state)
    const second = selectors.selectStudioMessages({
      ...state,
      connection: {
        ...state.connection,
        lastEventAt: Date.now(),
        lastEventType: 'studio.heartbeat',
      },
    })

    expect(second).toBe(first)
    expect(second[0]).toBe(assistantMessage)
  })
})

function createSession(): StudioSession {
  const now = '2026-03-22T00:00:00.000Z'
  return {
    id: 'session-1',
    projectId: 'project-1',
    agentType: 'builder',
    title: 'Studio',
    directory: 'D:/projects/ManimCat',
    createdAt: now,
    updatedAt: now,
  }
}

function createAssistantMessage(): StudioAssistantMessage {
  const now = '2026-03-22T00:00:00.000Z'
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    agent: 'builder',
    parts: [
      {
        id: 'part-1',
        messageId: 'message-1',
        sessionId: 'session-1',
        type: 'text',
        text: 'hello',
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}
