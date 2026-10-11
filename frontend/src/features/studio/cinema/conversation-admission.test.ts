import { describe, expect, it } from 'vitest'
import { createSceneState, mergeAcceptedRun } from './scene-state'
import { createTestScene, createTestRun, CINEMA_TEST_ISO } from './cinema-fixtures'
import type { StudioSceneMessage } from '../protocol/studio-agent-types'

describe('incremental conversation admission', () => {
  it('replaces the optimistic message without losing history or a reply received over SSE', () => {
    const identity = { sessionId: 'session', sceneId: 'scene' }
    const scene = createTestScene(identity.sessionId, identity.sceneId, 0)
    const user = (id: string, text: string): StudioSceneMessage => ({
      ...identity, id, role: 'user', text, createdAt: CINEMA_TEST_ISO, updatedAt: CINEMA_TEST_ISO,
    })
    const assistant: StudioSceneMessage = {
      ...identity, id: 'assistant', role: 'assistant', agent: 'builder',
      createdAt: CINEMA_TEST_ISO, updatedAt: CINEMA_TEST_ISO,
      parts: [{ id: 'text', messageId: 'assistant', sessionId: 'session', type: 'text', text: 'arrived before 202' }],
    }
    const state = { ...createSceneState(identity, scene), submitting: true,
      pendingUserMessageId: 'pending', messages: [user('history', 'old message'), user('pending', 'draw'), assistant] }
    const run = createTestRun('scene', 'run', 'running', 'session')
    const merged = mergeAcceptedRun(state, {
      scene, incremental: true, run, runs: [run], renders: [],
      messages: [user('accepted-user', 'draw'), { ...assistant, parts: [] }],
    })
    expect(merged.messages.map(message => message.id)).toEqual(['accepted-user', 'assistant', 'history'])
    expect(merged.messages.find(message => message.id === 'assistant')).toEqual(assistant)
    expect(merged.pendingUserMessageId).toBeNull()
    expect(merged.submitting).toBe(false)
  })
})
