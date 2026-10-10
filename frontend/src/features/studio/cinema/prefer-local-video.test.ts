import { describe, expect, it } from 'vitest'
import { preferStudioCinemaLocalVideo, type StudioCinemaPlayableMedia } from './media-locators'

const videoMedia: StudioCinemaPlayableMedia = {
  attachment: { kind: 'video', url: '/videos/job-1.mp4' } as unknown as StudioCinemaPlayableMedia['attachment'],
  kind: 'video',
  url: '/videos/job-1.mp4'
}

const imageMedia: StudioCinemaPlayableMedia = {
  attachment: { kind: 'image', url: '/images/job-1-0.png' } as unknown as StudioCinemaPlayableMedia['attachment'],
  kind: 'image',
  url: '/images/job-1-0.png'
}

describe('preferStudioCinemaLocalVideo', () => {
  it('replaces only the URL, keeping the render metadata', () => {
    const preferred = preferStudioCinemaLocalVideo(videoMedia, 'blob:local-copy')

    expect(preferred?.url).toBe('blob:local-copy')
    expect(preferred?.attachment).toBe(videoMedia.attachment)
    expect(preferred?.kind).toBe('video')
  })

  it('keeps the server locator when this page has no local copy', () => {
    expect(preferStudioCinemaLocalVideo(videoMedia, null)).toBe(videoMedia)
    expect(preferStudioCinemaLocalVideo(videoMedia, undefined)).toBe(videoMedia)
    expect(preferStudioCinemaLocalVideo(videoMedia, '')).toBe(videoMedia)
  })

  it('never turns an image into a video', () => {
    expect(preferStudioCinemaLocalVideo(imageMedia, 'blob:local-copy')).toBe(imageMedia)
  })

  it('answers null when there is no media at all', () => {
    expect(preferStudioCinemaLocalVideo(null, 'blob:local-copy')).toBeNull()
  })
})
