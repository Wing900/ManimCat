import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n/index'
import { DEFAULT_NARRATION } from '../../infrastructure/storage/settings'
import type { VideoConfig } from '../../shared/types/api'
import { VideoSettings } from './VideoSettings'

const baseVideo: VideoConfig = {
  quality: 'medium',
  frameRate: 60,
  timeout: 1200,
  bgm: false,
}

function renderSettings(videoConfig: VideoConfig, onUpdate = vi.fn()) {
  render(
    <I18nProvider>
      <VideoSettings videoConfig={videoConfig} onUpdate={onUpdate} />
    </I18nProvider>,
  )
  return onUpdate
}

describe('VideoSettings narration', () => {
  it('keeps voice and rate hidden while narration is off, then enables it', () => {
    const onUpdate = renderSettings(baseVideo)

    expect(screen.queryByText('Voice')).not.toBeInTheDocument()
    expect(screen.queryByText('Speech Rate')).not.toBeInTheDocument()

    const [, narrationSwitch] = screen.getAllByRole('switch')
    expect(narrationSwitch).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(narrationSwitch)

    expect(onUpdate).toHaveBeenCalledWith({
      narration: { ...DEFAULT_NARRATION, enabled: true },
    })
  })

  it('shows the preset voice and rate and preserves quality, frame rate and BGM', () => {
    const onUpdate = renderSettings({
      ...baseVideo,
      bgm: true,
      narration: { ...DEFAULT_NARRATION, enabled: true },
    })

    expect(screen.getByText('Voice')).toBeInTheDocument()
    expect(screen.getByText('Speech Rate')).toBeInTheDocument()
    expect(screen.getByText('Xiaoxiao (Chinese, female)')).toBeInTheDocument()
    expect(screen.getByText('Normal')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Normal' }))
    fireEvent.click(screen.getByText('Slightly faster'))

    expect(onUpdate).toHaveBeenCalledWith({
      narration: { ...DEFAULT_NARRATION, enabled: true, rate: '+20%' },
    })
  })
})
