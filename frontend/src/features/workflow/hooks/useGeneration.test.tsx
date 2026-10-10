import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGeneration } from './useGeneration'
import { cancelJob, generateAnimation, getJobStatus, modifyAnimation } from '../../../infrastructure/api/api'
import { I18nProvider } from '../../../shared/i18n/index'

vi.mock('../lib/api', () => ({
  generateAnimation: vi.fn(),
  getJobStatus: vi.fn(),
  cancelJob: vi.fn(),
  modifyAnimation: vi.fn(),
}))

vi.mock('../lib/settings', () => ({
  loadSettings: () => ({
    video: { timeout: 1200 },
    api: {},
  }),
}))

vi.mock('../lib/ai-providers', () => ({
  getActiveProvider: () => null,
  providerToCustomApiConfig: () => null,
}))

vi.mock('./usePrompts', () => ({
  loadPrompts: () => undefined,
}))

const mockedGenerateAnimation = vi.mocked(generateAnimation)
const mockedGetJobStatus = vi.mocked(getJobStatus)
const mockedCancelJob = vi.mocked(cancelJob)
const mockedModifyAnimation = vi.mocked(modifyAnimation)

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

describe('useGeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    sessionStorage.clear()
    mockedGenerateAnimation.mockResolvedValue({
      success: true,
      jobId: 'job-1',
      message: 'ok',
      status: 'processing',
      submittedAt: '2026-03-22T00:00:00.000Z',
    })
    mockedModifyAnimation.mockResolvedValue({
      success: true,
      jobId: 'job-1',
      message: 'ok',
      status: 'processing',
      submittedAt: '2026-03-22T00:00:00.000Z',
    })
    mockedCancelJob.mockResolvedValue()
    mockedGetJobStatus.mockResolvedValue({
      jobId: 'job-1',
      status: 'processing',
      stage: 'analyzing',
      message: 'running',
      submitted_at: '2026-03-22T00:00:00.000Z',
      revision: 1,
      attempt: 1,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not cancel the job when polling hits a non-network error', async () => {
    mockedGetJobStatus.mockRejectedValueOnce(new Error('Unexpected JSON parse failure'))

    const { result } = renderHook(() => useGeneration(), { wrapper })

    await act(async () => {
      await result.current.generate({ concept: 'test', outputMode: 'video' })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Unexpected JSON parse failure')
    expect(mockedCancelJob).not.toHaveBeenCalled()
  })

  it('restores an active job from session storage and resumes polling', async () => {
    sessionStorage.setItem('manimcat_active_job', JSON.stringify({
      jobId: 'job-restore',
    }))
    mockedGetJobStatus.mockResolvedValueOnce({
      jobId: 'job-restore',
      status: 'processing',
      stage: 'rendering',
      message: 'running',
      submitted_at: '2026-03-22T00:00:00.000Z',
      revision: 3,
      attempt: 1,
    })

    const { result } = renderHook(() => useGeneration(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current.jobId).toBe('job-restore')
    expect(result.current.status).toBe('processing')
    expect(result.current.submittedAt).toBe('2026-03-22T00:00:00.000Z')
  })

  it('resumes polling if cancel request fails', async () => {
    mockedCancelJob.mockRejectedValueOnce(new Error('cancel failed'))

    const { result } = renderHook(() => useGeneration(), { wrapper })

    await act(async () => {
      await result.current.generate({ concept: 'test', outputMode: 'video' })
    })

    await act(async () => {
      result.current.cancel()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.status).toBe('processing')
    expect(result.current.jobId).toBe('job-1')
    expect(result.current.submittedAt).toBe('2026-03-22T00:00:00.000Z')
  })

  it('persists submittedAt from the backend response for resumed timing', async () => {
    const { result } = renderHook(() => useGeneration(), { wrapper })

    await act(async () => {
      await result.current.generate({ concept: 'test', outputMode: 'video' })
    })

    expect(result.current.submittedAt).toBe('2026-03-22T00:00:00.000Z')
    expect(sessionStorage.getItem('manimcat_active_job')).toBe('{"jobId":"job-1"}')
  })

  it('ignores stale poll responses with an older revision', async () => {
    mockedGetJobStatus
      .mockResolvedValueOnce({
        jobId: 'job-1',
        status: 'processing',
        stage: 'rendering',
        message: 'running',
        submitted_at: '2026-03-22T00:00:00.000Z',
        revision: 5,
        attempt: 2,
      })
      .mockResolvedValueOnce({
        jobId: 'job-1',
        status: 'processing',
        stage: 'generating',
        message: 'stale',
        submitted_at: '2026-03-22T00:00:00.000Z',
        revision: 4,
        attempt: 1,
      })

    const { result } = renderHook(() => useGeneration(), { wrapper })

    await act(async () => {
      await result.current.generate({ concept: 'test', outputMode: 'video' })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current.stage).toBe('rendering')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current.stage).toBe('rendering')
  })
})
