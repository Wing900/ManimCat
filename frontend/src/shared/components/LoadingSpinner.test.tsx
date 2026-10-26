import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/index'
import { LoadingSpinner } from './LoadingSpinner'
import type { JobStageHistoryEntry } from '../types/api'

const history: JobStageHistoryEntry[] = [
  {
    stage: 'designing',
    started_at: '2026-10-26T13:00:00.000Z',
    ended_at: '2026-10-26T13:00:25.200Z',
    duration_ms: 25_200,
  },
  {
    stage: 'generating',
    started_at: '2026-10-26T13:00:25.200Z',
    ended_at: '2026-10-26T13:01:42.300Z',
    duration_ms: 77_100,
  },
]

describe('LoadingSpinner stage history', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders settled stage durations in the hover tooltip', () => {
    render(
      <I18nProvider>
        <LoadingSpinner stage="rendering" stageHistory={history} />
      </I18nProvider>,
    )

    expect(screen.getByText('Stage time')).toBeInTheDocument()
    expect(screen.getByText('Designing')).toBeInTheDocument()
    expect(screen.getByText('25.2s')).toBeInTheDocument()
    expect(screen.getByText('Generating Code')).toBeInTheDocument()
    expect(screen.getByText('77.1s')).toBeInTheDocument()
  })

  it('hides sub-100ms stages from the tooltip', () => {
    render(
      <I18nProvider>
        <LoadingSpinner
          stage="generating"
          stageHistory={[
            {
              stage: 'queued',
              started_at: '2026-10-26T13:00:00.000Z',
              ended_at: '2026-10-26T13:00:00.008Z',
              duration_ms: 8,
            },
            ...history,
          ]}
        />
      </I18nProvider>,
    )

    expect(screen.queryByText('Queued')).not.toBeInTheDocument()
    expect(screen.getByText('Designing')).toBeInTheDocument()
  })
})
