import { describe, expect, it } from 'vitest'
import { studioEventReducer } from './studio-event-reducer'
import { createInitialStudioState } from './studio-session-store'
import type { StudioUserMessage } from '../protocol/studio-agent-types'
import { createSessionMessage, createAssistantMessageMessage, createRunMessage, readFirstAssistantText } from './studio-event-reducer.factories'

describe('studioEventReducer', () => {
  it('keeps the optimistic assistant message and stores the error when run submission fails', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSessionMessage(),
        messagesById: {
          'local-assistant-1': createAssistantMessageMessage(),
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
    const state = {
      ...createInitialStudioState(),
      runtime: {
        ...createInitialStudioState().runtime,
        activeRunId: 'run-old',
        assistantTextByRunId: {
          'run-old': '旧卡片内容',
        },
      },
    }
    const userMessage: StudioUserMessage = {
      id: 'local-user-1',
      sessionId: 'session-1',
      role: 'user',
      text: 'render this',
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
    }
    const assistantMessage = createAssistantMessageMessage()

    const next = studioEventReducer(state, {
      type: 'optimistic_messages_created',
      userMessage,
      assistantMessage,
    })

    expect(next.entities.messageOrder).toEqual(['local-user-1', 'local-assistant-1'])
    expect(next.runtime.pendingAssistantMessageId).toBe('local-assistant-1')
    expect(next.runtime.activeRunId).toBeNull()
  })

  it('writes assistant.text into the optimistic assistant message for the active run', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSessionMessage(),
        messagesById: {
          'local-assistant-1': createAssistantMessageMessage(),
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
          messageId: 'local-assistant-1',
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
        session: createSessionMessage(),
        messagesById: {
          'local-assistant-1': createAssistantMessageMessage(),
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
          messageId: 'local-assistant-1',
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
          messageId: 'local-assistant-1',
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
          messageId: 'local-assistant-1',
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

  it('keeps existing tool parts when assistant text streams after tool events', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSessionMessage(),
        messagesById: {
          'local-assistant-1': {
            ...createAssistantMessageMessage(),
            parts: [
              {
                id: 'tool-1',
                messageId: 'local-assistant-1',
                sessionId: 'session-1',
                type: 'tool' as const,
                tool: 'write',
                callId: 'call-1',
                state: {
                  status: 'running',
                  input: { path: 'heart.py' },
                  time: { start: 1 },
                },
              },
            ],
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
          messageId: 'local-assistant-1',
          text: '正在处理文件',
        },
      },
    })

    const message = next.entities.messagesById['local-assistant-1']
    expect(message?.role).toBe('assistant')
    expect(readFirstAssistantText(message)).toBe('正在处理文件')
    expect(message?.role === 'assistant' ? message.parts.some((part) => part.type === 'tool') : false).toBe(true)
  })

  it('does not let a stale running run overwrite a completed run', () => {
    const completedRun = createRunMessage({ status: 'completed', completedAt: '2026-03-22T00:00:05.000Z' })
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSessionMessage(),
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
      run: createRunMessage({ status: 'running' }),
      pendingPermissions: [],
    })

    expect(next.entities.runsById[completedRun.id]?.status).toBe('completed')
    expect(next.entities.runsById[completedRun.id]?.completedAt).toBe('2026-03-22T00:00:05.000Z')
  })

  it('creates a new assistant card when streaming events target a new server message before snapshot merge', () => {
    const state = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session: createSessionMessage(),
        messagesById: {
          'local-assistant-1': createAssistantMessageMessage(),
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
          messageId: 'server-assistant-2',
          text: '新的回复',
        },
      },
    })

    expect(readFirstAssistantText(next.entities.messagesById['server-assistant-2'])).toBe('新的回复')
    expect(readFirstAssistantText(next.entities.messagesById['local-assistant-1'])).toBe('')
    expect(next.runtime.assistantTextByRunId['run-1']).toBe('新的回复')
  })
})