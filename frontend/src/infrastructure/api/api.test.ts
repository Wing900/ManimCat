import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelJob, generateAnimation, getJobStatus } from './api'
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

describe('narration request pass-through', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('sends the full videoConfig narration settings on generate', async () => {
    localStorage.setItem('manimcat_settings', JSON.stringify({
      video: {
        quality: 'medium',
        frameRate: 60,
        timeout: 1200,
        bgm: true,
        narration: { enabled: true, voice: 'zh-CN-YunxiNeural', rate: '-10%' },
      },
    }))
    localStorage.setItem('manimcat_settings_version', '8')

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(String(input)).toBe('/api/generate')
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify({
        success: true,
        jobId: 'job-narration',
        message: 'ok',
        status: 'queued',
        submittedAt: '2026-10-27T00:00:00.000Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await generateAnimation({ concept: 'narration test', outputMode: 'video' })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.videoConfig).toMatchObject({
      quality: 'medium',
      frameRate: 60,
      bgm: true,
      narration: { enabled: true, voice: 'zh-CN-YunxiNeural', rate: '-10%' },
    })
  })
})
