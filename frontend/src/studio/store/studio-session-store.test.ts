import { describe, expect, it } from 'vitest'
import { createInitialStudioState, mergeStudioSnapshot } from './studio-session-store'
import type { StudioAssistantMessage, StudioRun, StudioSession, StudioSessionSnapshot, StudioUserMessage } from '../protocol/studio-agent-types'

describe('mergeStudioSnapshot', () => {
  it('replaces an empty optimistic assistant placeholder with the incoming server assistant message', () => {
    const session = createSession()
    const current = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        messagesById: {
          'local-user-1': createUserMessage('local-user-1', '请开始', '2026-03-24T00:00:00.000Z'),
          'local-assistant-1': createAssistantMessage('local-assistant-1', [], '2026-03-24T00:00:00.000Z'),
        },
        messageOrder: ['local-user-1', 'local-assistant-1'],
      },
    }

    const snapshot: StudioSessionSnapshot = {
      session,
      messages: [
        createUserMessage('server-user-1', '请开始', '2026-03-24T00:00:01.000Z'),
        createAssistantMessage('server-assistant-1', [
          {
            id: 'part-1',
            messageId: 'server-assistant-1',
            sessionId: session.id,
            type: 'text',
            text: '这是正式回复',
          },
        ], '2026-03-24T00:00:40.000Z'),
      ],
      runs: [],
      tasks: [],
      works: [],
      workResults: [],
    }

    const next = mergeStudioSnapshot(current, snapshot, [])

    expect(next.entities.messagesById['local-assistant-1']).toBeUndefined()
    expect(next.entities.messagesById['server-assistant-1']?.role).toBe('assistant')
    expect(next.entities.messageOrder).toEqual(['server-user-1', 'server-assistant-1'])
  })

  it('replaces a streamed optimistic assistant message with an equivalent server assistant message', () => {
    const session = createSession()
    const current = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        messagesById: {
          'local-assistant-1': createAssistantMessage('local-assistant-1', [
            {
              id: 'part-local-1',
              messageId: 'local-assistant-1',
              sessionId: session.id,
              type: 'text',
              text: '好的！我来为你创建一个美观、精确的爱心图像。',
            },
          ], '2026-03-24T00:00:00.000Z'),
        },
        messageOrder: ['local-assistant-1'],
      },
    }

    const snapshot: StudioSessionSnapshot = {
      session,
      messages: [
        createAssistantMessage('server-assistant-1', [
          {
            id: 'part-server-1',
            messageId: 'server-assistant-1',
            sessionId: session.id,
            type: 'text',
            text: '好的！我来为你创建一个美观、精确的爱心图像。\n\n我选择使用经典的参数方程来绘制爱心。',
          },
        ], '2026-03-24T00:01:00.000Z'),
      ],
      runs: [],
      tasks: [],
      works: [],
      workResults: [],
    }

    const next = mergeStudioSnapshot(current, snapshot, [])

    expect(next.entities.messagesById['local-assistant-1']).toBeUndefined()
    expect(next.entities.messagesById['server-assistant-1']?.role).toBe('assistant')
    expect(next.entities.messageOrder).toEqual(['server-assistant-1'])
  })

  it('keeps a terminal run when a stale running snapshot arrives later', () => {
    const session = createSession()
    const current = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        runsById: {
          'run-1': createRun({
            status: 'completed',
            completedAt: '2026-03-24T00:00:05.000Z',
          }),
        },
        runOrder: ['run-1'],
      },
    }

    const snapshot: StudioSessionSnapshot = {
      session,
      messages: [],
      runs: [
        createRun({
          status: 'running',
          completedAt: undefined,
        }),
      ],
      tasks: [],
      works: [],
      workResults: [],
    }

    const next = mergeStudioSnapshot(current, snapshot, [])

    expect(next.entities.runsById['run-1']?.status).toBe('completed')
    expect(next.entities.runsById['run-1']?.completedAt).toBe('2026-03-24T00:00:05.000Z')
  })
})

function createSession(): StudioSession {
  const now = '2026-03-24T00:00:00.000Z'
  return {
    id: 'session-1',
    projectId: 'project-1',
    agentType: 'builder',
    title: 'Studio',
    directory: 'D:/projects/ManimCat',
    permissionLevel: 'L2',
    permissionRules: [],
    createdAt: now,
    updatedAt: now,
  }
}

function createUserMessage(id: string, text: string, createdAt: string): StudioUserMessage {
  return {
    id,
    sessionId: 'session-1',
    role: 'user',
    text,
    createdAt,
    updatedAt: createdAt,
  }
}

function createAssistantMessage(
  id: string,
  parts: StudioAssistantMessage['parts'],
  createdAt: string,
): StudioAssistantMessage {
  return {
    id,
    sessionId: 'session-1',
    role: 'assistant',
    agent: 'builder',
    parts,
    createdAt,
    updatedAt: createdAt,
  }
}

function createRun(overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    status: 'running',
    inputText: '请开始',
    activeAgent: 'builder',
    createdAt: '2026-03-24T00:00:00.000Z',
    ...overrides,
  }
}
