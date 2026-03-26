import { describe, expect, it } from 'vitest'
import { studioEventReducer } from './studio-event-reducer'
import { createInitialStudioState } from './studio-session-store'
import type { StudioAssistantMessage, StudioRun, StudioSession, StudioTextPart, StudioUserMessage } from '../protocol/studio-agent-types'

describe('studioEventReducer', () => {
  it('keeps the optimistic assistant message and stores the error when run submission fails', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSession(),
        messagesById: {
          'local-assistant-1': createAssistantMessage(),
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
    expect(readFirstAssistantText(next.entities.messagesById['local-assistant-1'])).toBe('Studio provider config is incomplete')
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
    const assistantMessage = createAssistantMessage()

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
        session: createSession(),
        messagesById: {
          'local-assistant-1': createAssistantMessage(),
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
    expect(readFirstAssistantText(message)).toBe('hello')
    expect(next.runtime.assistantTextByRunId['run-1']).toBe('hello')
  })

  it('materializes tool events into the optimistic assistant message in real time', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSession(),
        messagesById: {
          'local-assistant-1': createAssistantMessage(),
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

    const started = studioEventReducer(state, {
      type: 'event_received',
      event: {
        type: 'tool.input-start',
        properties: {
          sessionId: 'session-1',
          runId: 'run-1',
          toolName: 'write',
          callId: 'call-1',
          raw: '{"path":"heart.py"}',
        },
      },
    })

    const running = studioEventReducer(started, {
      type: 'event_received',
      event: {
        type: 'tool.call',
        properties: {
          sessionId: 'session-1',
          runId: 'run-1',
          toolName: 'write',
          callId: 'call-1',
          input: { path: 'heart.py' },
        },
      },
    })

    const completed = studioEventReducer(running, {
      type: 'event_received',
      event: {
        type: 'tool.result',
        properties: {
          sessionId: 'session-1',
          runId: 'run-1',
          toolName: 'write',
          callId: 'call-1',
          status: 'completed',
          output: 'ok',
          title: 'Completed write',
        },
      },
    })

    const message = completed.entities.messagesById['local-assistant-1']
    expect(message?.role).toBe('assistant')
    const toolPart = message?.role === 'assistant' ? message.parts.find((part) => part.type === 'tool') : null
    expect(toolPart?.type).toBe('tool')
    expect(toolPart?.tool).toBe('write')
    expect(toolPart?.state.status).toBe('completed')
  })

  it('does not let a stale running run overwrite a completed run', () => {
    const completedRun = createRun({ status: 'completed', completedAt: '2026-03-22T00:00:05.000Z' })
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSession(),
        runsById: {
          [completedRun.id]: completedRun,
        },
        runOrder: [completedRun.id],
      },
      runtime: {
        ...createInitialStudioState().runtime,
        activeRunId: completedRun.id,
      },
    }

    const next = studioEventReducer(state, {
      type: 'run_started',
      run: createRun({ status: 'running' }),
      pendingPermissions: [],
    })

    expect(next.entities.runsById[completedRun.id]?.status).toBe('completed')
    expect(next.entities.runsById[completedRun.id]?.completedAt).toBe('2026-03-22T00:00:05.000Z')
  })
})

function createSession(): StudioSession {
  return {
    id: 'session-1',
    projectId: 'project-1',
    agentType: 'builder',
    title: 'Studio',
    directory: 'D:/projects/ManimCat',
    permissionLevel: 'L2',
    permissionRules: [],
    createdAt: '2026-03-22T00:00:00.000Z',
    updatedAt: '2026-03-22T00:00:00.000Z',
  }
}

function createAssistantMessage(): StudioAssistantMessage {
  return {
    id: 'local-assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    agent: 'builder',
    parts: [],
    createdAt: '2026-03-22T00:00:00.000Z',
    updatedAt: '2026-03-22T00:00:00.000Z',
  }
}

function createRun(overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    status: 'running',
    inputText: 'render this',
    activeAgent: 'builder',
    createdAt: '2026-03-22T00:00:00.000Z',
    ...overrides,
  }
}

function readFirstAssistantText(message: StudioAssistantMessage | StudioUserMessage | undefined): string {
  if (!message || message.role !== 'assistant') {
    return ''
  }
  const firstPart = message.parts[0] as StudioTextPart | undefined
  return firstPart?.type === 'text' ? firstPart.text : ''
}
