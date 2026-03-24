import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StudioCommandPanel } from './StudioCommandPanel'
import type { StudioMessage, StudioSession } from '../protocol/studio-agent-types'

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (_key: string) => '输入指令...',
  }),
}))

function createSession(): StudioSession {
  const now = '2026-03-22T00:00:00.000Z'
  return {
    id: 'session-1',
    projectId: 'project-1',
    agentType: 'builder',
    title: 'Studio',
    directory: 'D:/projects/ManimCat',
    permissionLevel: 'L2',
    permissionRules: [],
    createdAt: now,
    updatedAt: now,
  }
}

function createAssistantMessage(): Extract<StudioMessage, { role: 'assistant' }> {
  const now = '2026-03-22T00:00:00.000Z'
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    agent: 'builder',
    parts: [],
    createdAt: now,
    updatedAt: now,
  }
}

describe('StudioCommandPanel', () => {
  it('restores the input when submit fails', async () => {
    const onRun = vi.fn(async () => {
      throw new Error('submit failed')
    })

    render(
      <StudioCommandPanel
        session={createSession()}
        messages={[]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={onRun}
        onExit={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('输入指令...') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'render current file' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onRun).toHaveBeenCalledWith('render current file'))
    await waitFor(() => expect(input.value).toBe('render current file'))
  })

  it('does not flash the full assistant text before typing starts', async () => {
    vi.useFakeTimers()

    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)
    window.cancelAnimationFrame = (id: number) => window.clearTimeout(id)

    try {
      render(
        <StudioCommandPanel
          session={createSession()}
          messages={[createAssistantMessage()]}
          latestAssistantText="你好，世界"
          isBusy
          disabled={false}
          onRun={vi.fn()}
          onExit={vi.fn()}
        />,
      )

      expect(screen.queryByText('你好，世界')).not.toBeInTheDocument()

      await act(async () => {
        vi.runOnlyPendingTimers()
      })

      expect(screen.getByText(/你/)).toBeInTheDocument()
      expect(screen.queryByText('你好，世界')).not.toBeInTheDocument()
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
      vi.useRealTimers()
    }
  })

  it('does not auto-scroll again for each typing animation step', async () => {
    vi.useFakeTimers()

    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)
    window.cancelAnimationFrame = (id: number) => window.clearTimeout(id)
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(
        <StudioCommandPanel
          session={createSession()}
          messages={[createAssistantMessage()]}
          latestAssistantText="正在生成内容"
          isBusy
          disabled={false}
          onRun={vi.fn()}
          onExit={vi.fn()}
        />,
      )

      await act(async () => {
        vi.runOnlyPendingTimers()
      })

      const initialCalls = scrollIntoView.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(scrollIntoView.mock.calls.length).toBe(initialCalls)
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      vi.useRealTimers()
    }
  })
})
