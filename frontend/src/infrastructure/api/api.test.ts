import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelJob, getJobStatus } from './api'
import { setCurrentLocale } from '../../shared/i18n/runtime'

describe('api error parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setCurrentLocale('en-US')
  })

  it('falls back to a stable message when job status returns an empty error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))

    await expect(getJobStatus('job-1')).rejects.toThrow('Failed to fetch job status')
  })

  it('falls back to a stable message when cancel returns invalid json', async () => {
    setCurrentLocale('zh-CN')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))

    await expect(cancelJob('job-2')).rejects.toThrow('取消任务失败')
  })
})
