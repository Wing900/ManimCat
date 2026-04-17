import type { StudioAssistantMessage, StudioRun, StudioSession, StudioUserMessage } from '../protocol/studio-agent-types'

export function createSession(): StudioSession {
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

export function createUserMessage(id: string, text: string, createdAt: string): StudioUserMessage {
  return {
    id,
    sessionId: 'session-1',
    role: 'user',
    text,
    createdAt,
    updatedAt: createdAt,
  }
}

export function createAssistantMessage(
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

export function createRun(overrides: Partial<StudioRun> = {}): StudioRun {
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