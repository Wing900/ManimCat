import { describe, expect, it } from 'vitest'
import { studioEventReducer } from './studio-event-reducer'
import { createInitialStudioState } from './studio-session-store'
import type { StudioAssistantMessage, StudioUserMessage } from '../protocol/studio-agent-types'

describe('studioEventReducer', () => {
  it('keeps the optimistic assistant message and stores the error when run submission fails', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: {
          id: 'session-1',
          projectId: 'project-1',
          agentType: 'builder',
          title: 'Studio',
          directory: 'D:/projects/ManimCat',
          permissionLevel: 'L2',
          permissionRules: [],
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T00:00:00.000Z',
        },
        messagesById: {
          'local-assistant-1': {
            id: 'local-assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [],
            createdAt: '2026-03-22T00:00:00.000Z',
            updatedAt: '2026-03-22T00:00:00.000Z',
          },
        },
        messageOrder: ['local-assistant-1'],
      },
      runtime: {
        ...createInitialStudioState().runtime,
        submitting: true,
        pendingAssistantMessageId: 'local-assistant-1',
      },
    }

    const next = studioEventReducer(state, {
      type: 'run_submit_failed',
      error: 'Studio provider config is incomplete',
    })

    expect(next.runtime.submitting).toBe(false)
    expect(next.error).toBe('Studio provider config is incomplete')
    expect(next.entities.messagesById['local-assistant-1']?.role).toBe('assistant')
    expect(
      next.entities.messagesById['local-assistant-1']?.role === 'assistant'
        ? next.entities.messagesById['local-assistant-1'].parts[0]?.text
        : '',
    ).toBe('Studio provider config is incomplete')
  })

  it('creates optimistic user and assistant messages before the run starts', () => {
    const state = createInitialStudioState()
    const userMessage: StudioUserMessage = {
      id: 'local-user-1',
      sessionId: 'session-1',
      role: 'user',
      text: 'render this',
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
    }
    const assistantMessage: StudioAssistantMessage = {
      id: 'local-assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      agent: 'builder',
      parts: [],
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
    }

    const next = studioEventReducer(state, {
      type: 'optimistic_messages_created',
      userMessage,
      assistantMessage,
    })

    expect(next.entities.messageOrder).toEqual(['local-user-1', 'local-assistant-1'])
    expect(next.runtime.pendingAssistantMessageId).toBe('local-assistant-1')
  })

  it('writes assistant.text into the optimistic assistant message for the active run', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: {
          id: 'session-1',
          projectId: 'project-1',
          agentType: 'builder',
          title: 'Studio',
          directory: 'D:/projects/ManimCat',
          permissionLevel: 'L2',
          permissionRules: [],
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T00:00:00.000Z',
        },
        messagesById: {
          'local-assistant-1': {
            id: 'local-assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [],
            createdAt: '2026-03-22T00:00:00.000Z',
            updatedAt: '2026-03-22T00:00:00.000Z',
          },
        },
        messageOrder: ['local-assistant-1'],
      },
      runtime: {
        ...createInitialStudioState().runtime,
        optimisticAssistantMessageIdByRunId: {
          'run-1': 'local-assistant-1',
        },
      },
    }

    const next = studioEventReducer(state, {
      type: 'event_received',
      event: {
        type: 'assistant.text',
        properties: {
          sessionId: 'session-1',
          runId: 'run-1',
          text: 'hello',
        },
      },
    })

    const message = next.entities.messagesById['local-assistant-1']
    expect(message?.role).toBe('assistant')
    expect(message?.role === 'assistant' ? message.parts[0]?.text : '').toBe('hello')
    expect(next.runtime.assistantTextByRunId['run-1']).toBe('hello')
  })
})
