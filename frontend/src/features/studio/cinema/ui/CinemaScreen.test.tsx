import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { I18nProvider } from '../../../../shared/i18n/index'
import { CinemaScreen, type CinemaScreenProps } from './CinemaScreen'

function renderScreen(overrides: Partial<CinemaScreenProps> = {}) {
  const props: CinemaScreenProps = {
    state: 'playable',
    studioKind: 'manim',
    sceneIndex: 0,
    playableUrl: 'scene-result.mp4',
    mediaKind: 'video',
    refreshPausedReasonKey: null,
    onResumeRefresh: () => {},
    onReconcile: () => {},
    ...overrides,
  }
  return render(
    <I18nProvider>
      <CinemaScreen {...props} />
    </I18nProvider>,
  )
}

describe('cinema screen media', () => {
  it('paints a video only once it has a size of its own', () => {
    renderScreen()
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    // A replaced element that has not received data yet has no intrinsic size, so it is laid out at the
    // CSS default object size. Painting that is the small box — wearing the media's hairline — that the
    // metadata then snaps away from: the shrunken video frame, and the jump after it.
    expect(video).toHaveClass('invisible')
    fireEvent.loadedMetadata(video!)
    expect(video).not.toHaveClass('invisible')
    // The entrance fade waits for that same moment instead of running while the element is hidden.
    expect(video).toHaveClass('studio-media-in')
  })

  it('paints an image only once it has a size of its own', () => {
    renderScreen({ playableUrl: 'scene-result.png', mediaKind: 'image' })
    const image = document.querySelector('img')
    expect(image).not.toBeNull()
    expect(image).toHaveClass('invisible')
    fireEvent.load(image!)
    expect(image).not.toHaveClass('invisible')
    expect(image).toHaveClass('studio-media-in')
  })
})
