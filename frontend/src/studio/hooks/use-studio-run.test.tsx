import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useStudioRun } from './use-studio-run'
import { StudioApiRequestError } from '../api/client'
import type {
  StudioPermissionRequest,
  StudioRun,
  StudioSession,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'
import { createStudioRun } from '../api/studio-agent-api'
import { buildStudioCreateRunInput } from '../api/studio-run-request'

vi.mock('../api/studio-agent-api', () => ({
  createStudioRun: vi.fn(),
}))

vi.mock('../api/studio-run-request', () => ({
  buildStudioCreateRunInput: vi.fn(),
}))

const mockedCreateStudioRun = vi.mocked(createStudioRun)
const mockedBuildStudioCreateRunInput = vi.mocked(buildStudioCreateRunInput)

function createSession(id = 'session-1'): StudioSession {
  const now = '2026-03-22T00:00:00.000Z'
  return {
    id,
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

function createRun(id: string, sessionId: string): StudioRun {
  return {
    id,
    sessionId,
    status: 'running',
    inputText: 'render this',
    activeAgent: 'builder',
    createdAt: '2026-03-22T00:00:00.000Z',
  }
}

function createPendingPermission(sessionId: string, id = 'perm-1'): StudioPermissionRequest {
  return {
    id,
    sessionID: sessionId,
    permission: 'render',
    patterns: ['**/*'],
    always: [],
  }
}

function createSnapshot(session: StudioSession): StudioSessionSnapshot {
  return {
    session,
    messages: [],
    runs: [],
    tasks: [],
    works: [],
    workResults: [],
  }
}

describe('useStudioRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedBuildStudioCreateRunInput.mockImplementation(({ session, inputText }) => ({
      sessionId: session.id,
      inputText,
      projectId: session.projectId,
    }))
  })

  it('submits a run and filters pending permissions to the active session', async () => {
    const session = createSession()
    const onOptimisticMessagesCreated = vi.fn()
    const onRunSubmitting = vi.fn()
    const onRunStarted = vi.fn()
    const onSnapshotLoaded = vi.fn()
    const onError = vi.fn()

    mockedCreateStudioRun.mockResolvedValue({
      ...createSnapshot(session),
      run: createRun('run-1', session.id),
      pendingPermissions: [
        createPendingPermission(session.id, 'perm-1'),
        createPendingPermission('other-session', 'perm-2'),
      ],
    })

    const { result } = renderHook(() => useStudioRun({
      session,
      onOptimisticMessagesCreated,
      onRunSubmitting,
      onRunStarted,
      onSnapshotLoaded,
      onError,
      recoverSession: vi.fn(),
    }))

    await result.current('render this')

    expect(onOptimisticMessagesCreated).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: expect.objectContaining({
        role: 'user',
        sessionId: session.id,
        text: 'render this',
      }),
      assistantMessage: expect.objectContaining({
        role: 'assistant',
        sessionId: session.id,
        agent: session.agentType,
      }),
    }))
    expect(onRunSubmitting).toHaveBeenCalledOnce()
    expect(onRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1', sessionId: session.id }),
      [expect.objectContaining({ id: 'perm-1' })],
    )
    expect(onSnapshotLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        runs: [expect.objectContaining({ id: 'run-1' })],
      }),
      [expect.objectContaining({ id: 'perm-1' })],
    )
    expect(onError).not.toHaveBeenCalled()
  })

  it('recovers once when the session no longer exists', async () => {
    const initialSession = createSession('session-1')
    const recoveredSession = createSession('session-2')
    const recoverSession = vi.fn(async () => recoveredSession)
    const onRunStarted = vi.fn()

    mockedCreateStudioRun
      .mockRejectedValueOnce(new StudioApiRequestError('Session not found', 'NOT_FOUND'))
      .mockResolvedValueOnce({
        ...createSnapshot(recoveredSession),
        run: createRun('run-2', recoveredSession.id),
        pendingPermissions: [createPendingPermission(recoveredSession.id)],
      })

    const { result } = renderHook(() => useStudioRun({
      session: initialSession,
      onOptimisticMessagesCreated: vi.fn(),
      onRunSubmitting: vi.fn(),
      onRunStarted,
      onSnapshotLoaded: vi.fn(),
      onError: vi.fn(),
      recoverSession,
    }))

    await result.current('continue')

    expect(recoverSession).toHaveBeenCalledOnce()
    expect(mockedCreateStudioRun).toHaveBeenCalledTimes(2)
    expect(onRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-2', sessionId: recoveredSession.id }),
      [expect.objectContaining({ sessionID: recoveredSession.id })],
    )
  })

  it('reports submit errors and rethrows them', async () => {
    const session = createSession()
    const onError = vi.fn()

    mockedBuildStudioCreateRunInput.mockImplementation(() => {
      throw new Error('Studio provider config is incomplete')
    })

    const { result } = renderHook(() => useStudioRun({
      session,
      onOptimisticMessagesCreated: vi.fn(),
      onRunSubmitting: vi.fn(),
      onRunStarted: vi.fn(),
      onSnapshotLoaded: vi.fn(),
      onError,
      recoverSession: vi.fn(),
    }))

    await expect(result.current('render')).rejects.toThrow('Studio provider config is incomplete')
    expect(onError).toHaveBeenCalledWith('Studio provider config is incomplete')
  })
})
