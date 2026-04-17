import type { StudioAssistantMessage, StudioRun, StudioSession } from '../protocol/studio-agent-types'

export function createSessionMessage(): StudioSession {
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

export function createAssistantMessageMessage(): StudioAssistantMessage {
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

export function createRunMessage(overrides: Partial<StudioRun> = {}): StudioRun {
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

export function readFirstAssistantText(message: StudioAssistantMessage | undefined): string {
  if (!message || message.role !== 'assistant') {
    return ''
  }
  const firstPart = message.parts[0]
  return firstPart?.type === 'text' ? firstPart.text : ''
}