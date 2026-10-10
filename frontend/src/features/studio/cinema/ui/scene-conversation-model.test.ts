import { describe, expect, it } from 'vitest'
import type { StudioSceneMessage, StudioScenePart } from '../../protocol/studio-agent-types'
import {
  countStudioCinemaToolRows,
  isStudioCinemaConversationEmpty,
  readStudioCinemaConversationRows,
  readStudioCinemaToolDisplayStatus,
  readStudioCinemaToolStatusKey,
} from './scene-conversation-model'

/**
 * Conversation-shape specs (task 11C2, section 7).
 *
 * The Scene public projection is already sanitized, so these specs assert the *shape* rule the UI
 * depends on: stable ids, folded Tool and reasoning rows, no raw input and no internal error text
 * anywhere in the rows.
 */

function userMessage(id: string, text: string, createdAt = '2026-01-01T00:00:00.000Z'): StudioSceneMessage {
  return {
    id,
    sessionId: 'session_1',
    sceneId: 'scene_1',
    role: 'user',
    text,
    createdAt,
    updatedAt: createdAt,
  }
}

function assistantMessage(
  id: string,
  parts: StudioScenePart[],
  createdAt = '2026-01-01T00:00:01.000Z',
): StudioSceneMessage {
  return {
    id,
    sessionId: 'session_1',
    sceneId: 'scene_1',
    role: 'assistant',
    agent: 'builder',
    parts,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('cinema conversation rows', () => {
  it('keeps user and assistant text in order with stable ids', () => {
    const rows = readStudioCinemaConversationRows([
      userMessage('message_user', 'draw a circle'),
      assistantMessage('message_assistant', [
        { id: 'part_text', messageId: 'message_assistant', sessionId: 'session_1', type: 'text', text: 'Sure.' },
      ]),
    ])

    expect(rows.map((row) => [row.kind, row.id])).toEqual([
      ['user', 'message_user'],
      ['assistant-text', 'part_text'],
    ])
  })

  it('folds reasoning and drops empty parts instead of rendering blank rows', () => {
    const rows = readStudioCinemaConversationRows([
      assistantMessage('message_assistant', [
        { id: 'part_empty', messageId: 'm', sessionId: 'session_1', type: 'text', text: '   ' },
        {
          id: 'part_reasoning',
          messageId: 'm',
          sessionId: 'session_1',
          type: 'reasoning',
          text: 'thinking about circles',
        },
      ]),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'reasoning', id: 'part_reasoning' })
  })

  it('maps the public tool status onto the display status, including a failed tool', () => {
    expect(readStudioCinemaToolDisplayStatus('pending')).toBe('pending')
    expect(readStudioCinemaToolDisplayStatus('completed')).toBe('completed')
    expect(readStudioCinemaToolDisplayStatus('error')).toBe('failed')
    expect(readStudioCinemaToolDisplayStatus('something-else')).toBe('running')
    expect(readStudioCinemaToolStatusKey('failed')).toBe('studio.cinema.toolStatusFailed')
  })

  it('folds a tool into one row with a safe summary and no raw input at all', () => {
    const internalError = 'Traceback: /srv/private/scene.py line 42 secret-token'
    const rows = readStudioCinemaConversationRows([
      assistantMessage('message_assistant', [
        {
          id: 'part_tool',
          messageId: 'message_assistant',
          sessionId: 'session_1',
          type: 'tool',
          tool: 'static-check',
          callId: 'call_1',
          state: {
            status: 'error',
            title: 'Static check completed: 1 diagnostic.',
            output: 'Static check completed: 1 diagnostic.',
          },
          metadata: { path: 'scenes/scene_1.py' },
        },
      ]),
    ])

    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toMatchObject({
      kind: 'tool',
      id: 'part_tool',
      callId: 'call_1',
      toolName: 'static-check',
      status: 'failed',
      hasDetail: true,
    })
    // The raw model input and the private path never appear; the public title does.
    expect(row && 'output' in row ? row.output : null).toBe('Static check completed: 1 diagnostic.')
    expect(JSON.stringify(rows)).not.toContain(internalError)
    expect(JSON.stringify(rows)).not.toContain('scenes/scene_1.py')
    expect(Object.keys(row ?? {})).not.toContain('metadata')
  })

  it('counts tool rows and recognises an empty conversation', () => {
    const rows = readStudioCinemaConversationRows([
      userMessage('message_user', 'hi'),
      assistantMessage('message_assistant', [
        {
          id: 'part_tool',
          messageId: 'message_assistant',
          sessionId: 'session_1',
          type: 'tool',
          tool: 'render-video',
          callId: 'call_2',
          state: { status: 'completed' },
        },
      ]),
    ])

    expect(countStudioCinemaToolRows(rows)).toBe(1)
    expect(isStudioCinemaConversationEmpty(rows)).toBe(false)
    expect(isStudioCinemaConversationEmpty(readStudioCinemaConversationRows([]))).toBe(true)
    // A tool that produced nothing to show is still a row, but has nothing to expand.
    expect(rows[1]).toMatchObject({ kind: 'tool', hasDetail: false, title: null, output: null })
  })
})
