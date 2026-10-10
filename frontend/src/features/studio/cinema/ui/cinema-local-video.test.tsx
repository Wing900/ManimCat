import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n/index'
import { CinemaScreen } from './CinemaScreen'

afterEach(cleanup)

describe('Cinema local video fallback', () => {
  it('tries the server video once when a local video fails', () => {
    const result = render(<I18nProvider><CinemaScreen state="playable" studioKind="manim" sceneIndex={0}
      playableUrl="blob:local" fallbackVideoUrl="/videos/server.mp4" mediaKind="video"
      refreshPausedReasonKey={null} onResumeRefresh={vi.fn()} onReconcile={vi.fn()} /></I18nProvider>)
    expect(result.container.querySelector('video')?.getAttribute('src')).toBe('blob:local')
    fireEvent.error(result.container.querySelector('video')!)
    expect(result.container.querySelector('video')?.getAttribute('src')).toBe('/videos/server.mp4')
    fireEvent.error(result.container.querySelector('video')!)
    expect(result.container.querySelector('video')?.getAttribute('src')).toBe('/videos/server.mp4')
    expect(result.container.querySelectorAll('button').length).toBeGreaterThan(0)
  })

  it('uses the new local source after the displayed result changes', () => {
    const props = { state: 'playable' as const, studioKind: 'manim' as const, sceneIndex: 0,
      mediaKind: 'video' as const, refreshPausedReasonKey: null, onResumeRefresh: vi.fn(), onReconcile: vi.fn() }
    const result = render(<I18nProvider><CinemaScreen {...props} playableUrl="blob:first" fallbackVideoUrl="/videos/first.mp4" /></I18nProvider>)
    fireEvent.error(result.container.querySelector('video')!)
    result.rerender(<I18nProvider><CinemaScreen {...props} playableUrl="blob:second" fallbackVideoUrl="/videos/second.mp4" /></I18nProvider>)
    expect(result.container.querySelector('video')?.getAttribute('src')).toBe('blob:second')
  })
})
