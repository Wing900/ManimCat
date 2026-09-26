import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { RunStatus } from './RunStatus'
import { formatStudioTokenCount } from './format-studio-token-count'
import { StudioTokenUsageView } from './StudioTokenUsageView'
import type { StudioRun, StudioTokenUsage } from '../protocol/studio-agent-types'

function createUsage(overrides: Partial<StudioTokenUsage> = {}): StudioTokenUsage {
  return {
    promptTokens: 1200,
    completionTokens: 300,
    totalTokens: 1500,
    measuredCalls: 3,
    unmeasuredCalls: 0,
    ...overrides,
  }
}

function createRun(overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    status: 'running',
    inputText: 'render this',
    activeAgent: 'builder',
    createdAt: '2026-03-22T00:00:00.000Z',
    ...overrides,
  }
}

function renderWithLocale(node: ReactNode, locale: 'zh-CN' | 'en-US' = 'en-US') {
  window.localStorage.setItem('manimcat_locale', locale)
  return render(<I18nProvider>{node}</I18nProvider>)
}

function renderRunStatus(run: StudioRun) {
  return renderWithLocale(
    <RunStatus
      latestRun={run}
      render={null}
      latestAssistantText=""
      snapshotStatus="ready"
      eventStatus="connected"
      onRefresh={() => undefined}
      onCancel={() => undefined}
    />,
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('StudioTokenUsageView', () => {
  it('renders the cumulative total, input, output and call counts', () => {
    renderWithLocale(<StudioTokenUsageView usage={createUsage()} />)

    expect(screen.getByText('Token Usage')).toBeTruthy()
    expect(screen.getByTestId('studio-token-usage-total')).toHaveTextContent('1500')
    expect(screen.getByTestId('studio-token-usage-input')).toHaveTextContent('1200')
    expect(screen.getByTestId('studio-token-usage-output')).toHaveTextContent('300')
    expect(screen.getByTestId('studio-token-usage-measured-calls')).toHaveTextContent('3')
    expect(screen.queryByTestId('studio-token-usage-unmeasured-calls')).toBeNull()
    expect(screen.queryByTestId('studio-token-usage-unmeasured')).toBeNull()
  })

  it('shows the localized unmeasured state when every call is unmeasured', () => {
    renderWithLocale(
      <StudioTokenUsageView
        usage={createUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0, measuredCalls: 0, unmeasuredCalls: 2 })}
      />,
    )

    expect(screen.getByTestId('studio-token-usage-unmeasured')).toHaveTextContent('Unmeasured (provider returned no usage)')
    expect(screen.getByTestId('studio-token-usage-unmeasured-calls')).toHaveTextContent('2')
    expect(screen.queryByTestId('studio-token-usage-total')).toBeNull()
  })

  it('localizes the unmeasured state for zh-CN', () => {
    renderWithLocale(
      <StudioTokenUsageView usage={createUsage({ totalTokens: 0, measuredCalls: 0, unmeasuredCalls: 1 })} />,
      'zh-CN',
    )

    expect(screen.getByTestId('studio-token-usage-unmeasured')).toHaveTextContent('未计量（提供方未返回用量）')
  })

  it('formats large counts compactly for the status column', () => {
    expect(formatStudioTokenCount(1500)).toBe('1500')
    expect(formatStudioTokenCount(9_999)).toBe('9999')
    expect(formatStudioTokenCount(12_345)).toBe('12.3k')
    expect(formatStudioTokenCount(2_000_000)).toBe('2M')
    expect(formatStudioTokenCount(0)).toBe('0')
    expect(formatStudioTokenCount(Number.NaN)).toBe('0')
    expect(formatStudioTokenCount(-5)).toBe('0')
  })
})

describe('RunStatus token usage block', () => {
  it('hides the token block when the run carries no usage', () => {
    renderRunStatus(createRun())

    expect(screen.queryByTestId('studio-token-usage')).toBeNull()
  })

  it('renders live cumulative usage inside the existing status panel', () => {
    renderRunStatus(createRun({ tokenUsage: createUsage() }))

    expect(screen.getByTestId('studio-token-usage')).toBeTruthy()
    expect(screen.getByTestId('studio-token-usage-total')).toHaveTextContent('1500')
    expect(screen.getByTestId('studio-token-usage-measured-calls')).toHaveTextContent('3')
  })

  it('keeps the existing run, render, event stream and snapshot presentation', () => {
    renderRunStatus(createRun({ tokenUsage: createUsage() }))

    expect(screen.getByText('Run')).toBeTruthy()
    expect(screen.getByText('Render')).toBeTruthy()
    expect(screen.getByText('Event Stream')).toBeTruthy()
    expect(screen.getByText('Snapshot')).toBeTruthy()
  })
})
