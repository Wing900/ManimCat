import { describe, expect, it } from 'vitest'
import { createInitialStudioState, mergeStudioSnapshot } from './studio-session-store'
import type { StudioSessionSnapshot } from '../protocol/studio-agent-types'
import { createSession, createUserMessage, createAssistantMessage, createRun } from './studio-session-store.factories'

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
    expect(next.runtime.pendingAssistantMessageId).toBeNull()
  })

  it('does not replace a new optimistic assistant placeholder with an older server assistant message', () => {
    const session = createSession()
    const current = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        messagesById: {
          'server-assistant-old': createAssistantMessage('server-assistant-old', [
            {
              id: 'part-old-1',
              messageId: 'server-assistant-old',
              sessionId: session.id,
              type: 'text',
              text: '上一条回复',
            },
          ], '2026-03-24T00:00:04.000Z'),
          'local-user-1': createUserMessage('local-user-1', '继续', '2026-03-24T00:00:05.000Z'),
          'local-assistant-1': createAssistantMessage('local-assistant-1', [], '2026-03-24T00:00:05.000Z'),
        },
        messageOrder: ['server-assistant-old', 'local-user-1', 'local-assistant-1'],
      },
    }

    const snapshot: StudioSessionSnapshot = {
      session,
      messages: [
        createAssistantMessage('server-assistant-old', [
          {
            id: 'part-old-1',
            messageId: 'server-assistant-old',
            sessionId: session.id,
            type: 'text',
            text: '上一条回复',
          },
        ], '2026-03-24T00:00:04.000Z'),
      ],
      runs: [],
      tasks: [],
      works: [],
      workResults: [],
    }

    const next = mergeStudioSnapshot(current, snapshot, [])

    expect(next.entities.messagesById['local-assistant-1']?.role).toBe('assistant')
    expect(next.entities.messagesById['server-assistant-old']?.role).toBe('assistant')
    expect(next.entities.messageOrder).toEqual(['server-assistant-old', 'local-user-1', 'local-assistant-1'])
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

  it('remaps active optimistic assistant bindings to the adopted server message id', () => {
    const session = createSession()
    const current = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        messagesById: {
          'local-assistant-1': createAssistantMessage('local-assistant-1', [], '2026-03-24T00:00:00.000Z'),
        },
        messageOrder: ['local-assistant-1'],
      },
      runtime: {
        ...createInitialStudioState().runtime,
        optimisticAssistantMessageIdByRunId: {
          'run-1': 'local-assistant-1',
        },
        pendingAssistantMessageId: 'local-assistant-1',
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
            text: '这是正式回复',
          },
        ], '2026-03-24T00:00:40.000Z'),
      ],
      runs: [
        createRun(),
      ],
      tasks: [],
      works: [],
      workResults: [],
    }

    const next = mergeStudioSnapshot(current, snapshot, [])

    expect(next.runtime.optimisticAssistantMessageIdByRunId['run-1']).toBe('server-assistant-1')
    expect(next.runtime.pendingAssistantMessageId).toBe('server-assistant-1')
    expect(next.entities.messagesById['server-assistant-1']?.renderId).toBe('local-assistant-1')
  })

  it('collapses duplicated server and optimistic assistant messages with identical tool and text payloads', () => {
    const session = createSession()
    const current = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        messagesById: {
          'local-assistant-1': createAssistantMessage('local-assistant-1', [
            {
              id: 'tool-local',
              messageId: 'local-assistant-1',
              sessionId: session.id,
              type: 'tool',
              tool: 'write',
              callId: 'call-1',
              state: {
                status: 'completed',
                input: { path: 'triangle_sss.py' },
                output: 'ok',
                title: 'Completed write',
                time: { start: 1, end: 2 },
              },
            },
            {
              id: 'text-local',
              messageId: 'local-assistant-1',
              sessionId: session.id,
              type: 'text',
              text: '我来为你制作几个关于全等三角形的教学图片。',
            },
          ], '2026-03-24T00:00:10.000Z'),
        },
        messageOrder: ['local-assistant-1'],
      },
    }

    const snapshot: StudioSessionSnapshot = {
      session,
      messages: [
        createAssistantMessage('server-assistant-1', [
          {
            id: 'tool-server',
            messageId: 'server-assistant-1',
            sessionId: session.id,
            type: 'tool',
            tool: 'write',
            callId: 'call-2',
            state: {
              status: 'completed',
              input: { path: 'triangle_sss.py' },
              output: 'ok',
              title: 'Completed write',
              time: { start: 3, end: 4 },
            },
          },
          {
            id: 'text-server',
            messageId: 'server-assistant-1',
            sessionId: session.id,
            type: 'text',
            text: '我来为你制作几个关于全等三角形的教学图片。',
          },
        ], '2026-03-24T00:00:12.000Z'),
      ],
      runs: [],
      tasks: [],
      works: [],
      workResults: [],
    }

    const next = mergeStudioSnapshot(current, snapshot, [])

    expect(Object.keys(next.entities.messagesById)).toEqual(['server-assistant-1'])
    expect(next.entities.messageOrder).toEqual(['server-assistant-1'])
  })

  it('preserves the same assistant message object when a snapshot re-sends unchanged content', () => {
    const session = createSession()
    const existingAssistant = createAssistantMessage('server-assistant-1', [
      {
        id: 'text-1',
        messageId: 'server-assistant-1',
        sessionId: session.id,
        type: 'text',
        text: '稳定内容',
      },
    ], '2026-03-24T00:00:10.000Z')
    existingAssistant.updatedAt = '2026-03-24T00:00:11.000Z'

    const current = {
      ...createInitialStudioState(),
      entities: {
        ...createInitialStudioState().entities,
        session,
        messagesById: {
          [existingAssistant.id]: existingAssistant,
        },
        messageOrder: [existingAssistant.id],
      },
    }

    const snapshot: StudioSessionSnapshot = {
      session,
      messages: [
        {
          ...existingAssistant,
          parts: existingAssistant.parts.map((part) => ({ ...part })),
        },
      ],
      runs: [],
      tasks: [],
      works: [],
      workResults: [],
    }

    const next = mergeStudioSnapshot(current, snapshot, [])

    expect(next.entities.messagesById['server-assistant-1']).toBe(existingAssistant)
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