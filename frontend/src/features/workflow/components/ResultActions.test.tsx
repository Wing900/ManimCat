import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../shared/i18n';
import { ResultActions } from './ResultActions';

const hasSubtitleSidecar = vi.fn();
const requestBurnedVideo = vi.fn();

vi.mock('../../../infrastructure/api/api', () => ({
  hasSubtitleSidecar: (...args: unknown[]) => hasSubtitleSidecar(...args),
  requestBurnedVideo: (...args: unknown[]) => requestBurnedVideo(...args),
}));

function renderActions(props: Partial<React.ComponentProps<typeof ResultActions>> = {}) {
  return render(
    <I18nProvider>
      <ResultActions
        videoUrl="/videos/job-1.mp4"
        quality="medium"
        outputMode="video"
        {...props}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('manimcat_locale', 'zh-CN');
  hasSubtitleSidecar.mockReset();
  requestBurnedVideo.mockReset();
  hasSubtitleSidecar.mockResolvedValue(true);
});

describe('ResultActions download flow', () => {
  it('offers the burn checkbox in the low-quality dialog when captions exist', async () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: '下载视频' }));

    expect(await screen.findByRole('switch', { name: '烧录字幕' })).toBeTruthy();
    expect(screen.getByText('烧录字幕')).toBeTruthy();
  });

  it('asks to burn or download as-is at the highest quality', async () => {
    renderActions({ quality: 'high' });
    fireEvent.click(screen.getByRole('button', { name: '下载视频' }));

    expect(await screen.findByText('烧录字幕并下载')).toBeTruthy();
  });

  it('downloads a pre-burned file without opening a dialog', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderActions({ quality: 'high', hardsubUrl: '/videos/job-1-hardsub.mp4' });

    fireEvent.click(screen.getByRole('button', { name: '下载视频' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    click.mockRestore();
  });

  it('burns the current video when the checkbox is checked', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    requestBurnedVideo.mockResolvedValue('/videos/job-1-hardsub.mp4');
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: '下载视频' }));
    fireEvent.click(await screen.findByRole('switch', { name: '烧录字幕' }));
    fireEvent.click(screen.getByRole('button', { name: '下载当前画质' }));

    await waitFor(() => expect(requestBurnedVideo).toHaveBeenCalledWith('/videos/job-1.mp4'));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
