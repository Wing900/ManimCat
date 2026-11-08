import { describe, expect, it } from 'vitest'
import { deriveSubtitleUrl, videoJobId } from './subtitle-url'

describe('deriveSubtitleUrl', () => {
  it('swaps an MP4 locator for its WebVTT sidecar', () => {
    expect(deriveSubtitleUrl('/videos/job-1.mp4')).toBe('/videos/job-1.vtt')
  })

  it('keeps a cache-busting query string', () => {
    expect(deriveSubtitleUrl('/videos/job-1.mp4?rev=3')).toBe('/videos/job-1.vtt?rev=3')
  })

  it('ignores local blob and data URLs', () => {
    expect(deriveSubtitleUrl('blob:http://localhost/abc')).toBeNull()
    expect(deriveSubtitleUrl('data:video/mp4;base64,AAAA')).toBeNull()
  })

  it('ignores anything that is not an MP4 locator', () => {
    expect(deriveSubtitleUrl('/videos/job-1.webm')).toBeNull()
    expect(deriveSubtitleUrl('')).toBeNull()
    expect(deriveSubtitleUrl(null)).toBeNull()
  })
})

describe('videoJobId', () => {
  it('extracts the id from a video locator', () => {
    expect(videoJobId('/videos/9b224a42-525c-42a0-b3c9-645a7b1e9679.mp4')).toBe('9b224a42-525c-42a0-b3c9-645a7b1e9679')
    expect(videoJobId('/videos/job-1.mp4?rev=3')).toBe('job-1')
  })

  it('rejects non-video locators', () => {
    expect(videoJobId('blob:http://localhost/abc')).toBeNull()
    expect(videoJobId('/videos/job-1.vtt')).toBeNull()
    expect(videoJobId('')).toBeNull()
  })
})
