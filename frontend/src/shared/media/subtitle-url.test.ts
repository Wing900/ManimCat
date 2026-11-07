import { describe, expect, it } from 'vitest'
import { deriveSubtitleUrl } from './subtitle-url'

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
