import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../shared/i18n';
import type { JobTimings } from '../../../shared/types/api';
import { TimingPanel } from './TimingPanel';

beforeEach(() => {
  localStorage.setItem('manimcat_locale', 'zh-CN');
});

describe('TimingPanel', () => {
  it('shows mux, store, and the unmeasured remainder without losing the measured total', () => {
    const timings: JobTimings = {
      queue: 1_000,
      analyze: 2_000,
      generate: 3_000,
      retry: 500,
      render: 10_000,
      mux: 2_000,
      store: 100,
      total: 19_000,
    };

    render(
      <I18nProvider>
        <TimingPanel timings={timings} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('音轨合成')).toBeInTheDocument();
    expect(screen.getByText('音轨合成').parentElement).toHaveTextContent('2.0s');
    expect(screen.getByText('存储')).toBeInTheDocument();
    expect(screen.getByText('存储').parentElement).toHaveTextContent('100ms');
    expect(screen.getByText('其他')).toBeInTheDocument();
    expect(screen.getByText('其他').parentElement).toHaveTextContent('400ms');
    expect(screen.getByText('19.0s')).toBeInTheDocument();
  });
});
