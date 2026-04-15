import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioCommandPanel, type StudioCommandPanelHandle } from '../../../studio/components/StudioCommandPanel'
import type { StudioMessage, StudioSession } from '../../../studio/protocol/studio-agent-types'
import { getStudioSessionSkills } from '../../../studio/api/studio-agent-api'

const { uploadReferenceImageMock, debugStudioMessagesMock } = vi.hoisted(() => ({
  uploadReferenceImageMock: vi.fn(),
  debugStudioMessagesMock: vi.fn(),
}))

vi.mock('../../../lib/api', () => ({
  uploadReferenceImage: uploadReferenceImageMock,
}))

vi.mock('../../../studio/agent-response/debug', () => ({
  debugStudioMessages: debugStudioMessagesMock,
}))

vi.mock('../../../studio/api/studio-agent-api', () => ({
  getStudioSessionSkills: vi.fn(),
}))

vi.mock('../../../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'studio.commandPlaceholder' || key === 'studio.initializing') {
        return '输入指令...'
      }
      return key
    },
  }),
}))

afterEach(() => {
  cleanup()
  uploadReferenceImageMock.mockReset()
  debugStudioMessagesMock.mockReset()
  vi.mocked(getStudioSessionSkills).mockReset()
})

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
  it('shows actual skill suggestions for /skill input and completes them with tab', async () => {
    vi.mocked(getStudioSessionSkills).mockResolvedValue([
      {
        name: 'math-education-visualization',
        description: 'Math teaching visualization skill.',
        scope: 'common',
        directory: 'D:/skills/math-education-visualization',
        entryFile: 'D:/skills/math-education-visualization/SKILL.md',
        source: 'catalog',
      },
    ])

    render(
      <StudioCommandPanel
        session={createSession()}
        messages={[]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('输入指令...') as HTMLInputElement
    fireEvent.change(input, { target: { value: '/skill math' } })

    await waitFor(() => expect(screen.getByText('math-education-visualization')).toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'Tab' })

    expect(input.value).toBe('/skill math-education-visualization')
  })

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

  it('shows command suggestions when typing slash and filters them by prefix', async () => {
    render(
      <StudioCommandPanel
        session={createSession()}
        messages={[]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('输入指令...') as HTMLInputElement
    fireEvent.change(input, { target: { value: '/' } })

    expect(screen.getByText('studio.commandMenu.title')).toBeInTheDocument()
    expect(screen.getByText('/history')).toBeInTheDocument()
    expect(screen.getByText('/new')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '/n' } })

    expect(screen.getByText('/new')).toBeInTheDocument()
    expect(screen.queryByText('/history')).not.toBeInTheDocument()
  })

  it('completes a command from the suggestion list with tab before submitting', async () => {
    const onRun = vi.fn()

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
    fireEvent.change(input, { target: { value: '/n' } })
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(input.value).toBe('/new')
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.queryByText('studio.commandMenu.title')).not.toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onRun).toHaveBeenCalledWith('/new'))
  })

  it('does not submit while a command suggestion is still open before tab completion', async () => {
    const onRun = vi.fn()

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
    fireEvent.change(input, { target: { value: '/n' } })

    expect(screen.getByText('studio.commandMenu.title')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onRun).not.toHaveBeenCalled())
    expect(input.value).toBe('/n')
    expect(screen.getByText('studio.commandMenu.title')).toBeInTheDocument()
  })

  it('hides the autocomplete menu when the input exactly matches a command', () => {
    render(
      <StudioCommandPanel
        session={createSession()}
        messages={[]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('输入指令...') as HTMLInputElement
    fireEvent.change(input, { target: { value: '/n' } })

    expect(screen.getByText('studio.commandMenu.title')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Tab' })

    expect(input.value).toBe('/new')
    expect(screen.queryByText('studio.commandMenu.title')).not.toBeInTheDocument()
  })

  it('scrolls the autocomplete list to keep the active command in view while navigating', () => {
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      render(
        <StudioCommandPanel
          session={createSession()}
          messages={[]}
          latestAssistantText=""
          isBusy={false}
          disabled={false}
          onRun={vi.fn()}
          onExit={vi.fn()}
        />,
      )

      const input = screen.getByPlaceholderText('输入指令...') as HTMLInputElement
      fireEvent.change(input, { target: { value: '/' } })
      scrollIntoView.mockClear()

      fireEvent.keyDown(input, { key: 'ArrowDown' })

      expect(scrollIntoView).toHaveBeenCalled()
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('executes the registered local image command without sending text to onRun', async () => {
    const onRun = vi.fn()

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
    fireEvent.change(input, { target: { value: '/p' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('canvasMode.title')).toBeInTheDocument())
    expect(onRun).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('forwards the skill command to onRun', async () => {
    const onRun = vi.fn()
    vi.mocked(getStudioSessionSkills).mockResolvedValue([
      {
        name: 'math-education-visualization',
        description: 'Math teaching visualization skill.',
        scope: 'common',
        directory: 'D:/skills/math-education-visualization',
        entryFile: 'D:/skills/math-education-visualization/SKILL.md',
        source: 'catalog',
      },
    ])

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
    fireEvent.change(input, { target: { value: '/skill math' } })
    await waitFor(() => expect(screen.getByText('math-education-visualization')).toBeInTheDocument())
    fireEvent.keyDown(input, { key: 'Tab' })
    await waitFor(() => expect(input.value).toBe('/skill math-education-visualization'))
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onRun).toHaveBeenCalledWith('/skill math-education-visualization'))
    expect(input.value).toBe('')
  })

  it('uploads pasted images into composer attachments', async () => {
    uploadReferenceImageMock.mockResolvedValue({
      success: true,
      url: '/images/pasted.png',
      relativeUrl: '/images/pasted.png',
      mimeType: 'image/png',
      size: 128,
    })

    render(
      <StudioCommandPanel
        session={createSession()}
        messages={[]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('输入指令...') as HTMLInputElement
    const file = new File(['image'], 'pasted.png', { type: 'image/png' })

    fireEvent.paste(input, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    })

    await waitFor(() => expect(uploadReferenceImageMock).toHaveBeenCalledWith(file))
    expect(screen.getByRole('img', { name: 'reference.alt' })).toBeInTheDocument()
    expect(input.value).toContain('@pasted.png')
  })

  it('uploads pasted images from document scope when composer is not focused', async () => {
    uploadReferenceImageMock.mockResolvedValue({
      success: true,
      url: '/images/document-pasted.png',
      relativeUrl: '/images/document-pasted.png',
      mimeType: 'image/png',
      size: 128,
    })

    render(
      <StudioCommandPanel
        session={createSession()}
        messages={[]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    const file = new File(['image'], 'document-pasted.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    })

    document.dispatchEvent(event)

    await waitFor(() => expect(uploadReferenceImageMock).toHaveBeenCalledWith(file))
    expect(screen.getByRole('img', { name: 'reference.alt' })).toBeInTheDocument()
    expect(debugStudioMessagesMock).toHaveBeenCalledWith('command-panel-document-paste', expect.objectContaining({
      imageCount: 1,
    }))
  })

  it('uploads dropped images into composer attachments', async () => {
    uploadReferenceImageMock.mockResolvedValue({
      success: true,
      url: '/images/dropped.png',
      relativeUrl: '/images/dropped.png',
      mimeType: 'image/png',
      size: 128,
    })

    const ref = createRef<StudioCommandPanelHandle>()

    render(
      <StudioCommandPanel
        ref={ref}
        session={createSession()}
        messages={[]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('输入指令...') as HTMLInputElement
    const file = new File(['image'], 'dropped.png', { type: 'image/png' })

    await ref.current?.ingestImageFiles([file])

    await waitFor(() => expect(uploadReferenceImageMock).toHaveBeenCalledWith(file))
    expect(screen.getByRole('img', { name: 'reference.alt' })).toBeInTheDocument()
    expect(input.value).toContain('@dropped.png')
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

  it('does not auto-scroll again when only latest assistant text grows during streaming', async () => {
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const { rerender } = render(
        <StudioCommandPanel
          session={createSession()}
          messages={[createAssistantMessage()]}
          latestAssistantText="你"
          isBusy
          disabled={false}
          onRun={vi.fn()}
          onExit={vi.fn()}
        />,
      )

      const initialCalls = scrollIntoView.mock.calls.length

      rerender(
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

      expect(scrollIntoView.mock.calls.length).toBe(initialCalls)
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('hides stale empty assistant placeholders once a real assistant reply exists', () => {
    const now = '2026-03-22T00:00:00.000Z'
    render(
      <StudioCommandPanel
        session={createSession()}
        messages={[
          {
            id: 'message-empty',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [],
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'message-real',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [
              {
                id: 'part-1',
                messageId: 'message-real',
                sessionId: 'session-1',
                type: 'text',
                text: '正式回复',
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    expect(screen.getByText('正式回复')).toBeInTheDocument()
    expect(screen.queryByText('暂无响应输出')).not.toBeInTheDocument()
  })

  it('hides a duplicated optimistic assistant message once the server reply with equivalent text arrives', () => {
    const now = '2026-03-22T00:00:00.000Z'
    const view = render(
      <StudioCommandPanel
        session={createSession()}
        messages={[
          {
            id: 'local-assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [
              {
                id: 'part-local-1',
                messageId: 'local-assistant-1',
                sessionId: 'session-1',
                type: 'text',
                text: '这是同一条回复',
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'server-assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [
              {
                id: 'part-server-1',
                messageId: 'server-assistant-1',
                sessionId: 'session-1',
                type: 'text',
                text: '这是同一条回复\n\n补充一点说明。',
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    expect(within(view.container).getAllByText(/这是同一条回复/)).toHaveLength(1)
  })

  it('hides duplicated assistant cards when tool call and text are identical', () => {
    const now = '2026-03-22T00:00:00.000Z'
    const view = render(
      <StudioCommandPanel
        session={createSession()}
        messages={[
          {
            id: 'message-dup-1',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [
              {
                id: 'tool-1',
                messageId: 'message-dup-1',
                sessionId: 'session-1',
                type: 'tool',
                tool: 'write',
                callId: 'call-1',
                state: {
                  status: 'completed',
                  input: { path: 'triangle_sss.py', content: 'import matplotlib.pyplot as plt' },
                  output: 'ok',
                  title: 'Completed write',
                  time: { start: 1, end: 2 },
                },
              },
              {
                id: 'text-1',
                messageId: 'message-dup-1',
                sessionId: 'session-1',
                type: 'text',
                text: '我来为你制作几个关于全等三角形的教学图片，包括常见的几种全等判定方法。',
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'message-dup-2',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [
              {
                id: 'tool-2',
                messageId: 'message-dup-2',
                sessionId: 'session-1',
                type: 'tool',
                tool: 'write',
                callId: 'call-2',
                state: {
                  status: 'completed',
                  input: { path: 'triangle_sss.py', content: 'import matplotlib.pyplot as plt' },
                  output: 'ok',
                  title: 'Completed write',
                  time: { start: 3, end: 4 },
                },
              },
              {
                id: 'text-2',
                messageId: 'message-dup-2',
                sessionId: 'session-1',
                type: 'text',
                text: '我来为你制作几个关于全等三角形的教学图片，包括常见的几种全等判定方法。',
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    expect(within(view.container).getAllByText(/我来为你制作几个关于全等三角形的教学图片/)).toHaveLength(1)
    expect(within(view.container).getAllByText(/write/i)).toHaveLength(1)
  })

  it('renders assistant text before the tool status line in the same bubble', () => {
    const now = '2026-03-22T00:00:00.000Z'
    const { container } = render(
      <StudioCommandPanel
        session={createSession()}
        messages={[
          {
            id: 'message-1',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [
              {
                id: 'tool-1',
                messageId: 'message-1',
                sessionId: 'session-1',
                type: 'tool',
                tool: 'write',
                callId: 'call-1',
                state: {
                  status: 'running',
                  input: { path: 'triangle_sss.py' },
                  time: { start: 1 },
                },
              },
              {
                id: 'text-1',
                messageId: 'message-1',
                sessionId: 'session-1',
                type: 'text',
                text: '我来为你制作图片。',
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    const bubble = container.querySelector('.rounded-2xl.bg-bg-tertiary\\/40')
    expect(bubble).not.toBeNull()
    const textIndex = bubble?.textContent?.indexOf('我来为你制作图片。') ?? -1
    const toolIndex = bubble?.textContent?.toLowerCase().indexOf('write') ?? -1
    expect(textIndex).toBeGreaterThanOrEqual(0)
    expect(toolIndex).toBeGreaterThan(textIndex)
  })

  it('renders markdown and math in studio messages', () => {
    const now = '2026-03-22T00:00:00.000Z'
    const { container } = render(
      <StudioCommandPanel
        session={createSession()}
        messages={[
          {
            id: 'message-user',
            sessionId: 'session-1',
            role: 'user',
            text: '请解释 **二次函数** 的顶点。',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'message-assistant',
            sessionId: 'session-1',
            role: 'assistant',
            agent: 'builder',
            parts: [
              {
                id: 'part-1',
                messageId: 'message-assistant',
                sessionId: 'session-1',
                type: 'text',
                text: '公式是 $y = ax^2 + bx + c$，其中 **顶点** 可由\n\n$$x = -\\frac{b}{2a}$$\n\n求出。',
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ]}
        latestAssistantText=""
        isBusy={false}
        disabled={false}
        onRun={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    expect(container.querySelector('strong')).not.toBeNull()
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(screen.getByText(/二次函数/)).toBeInTheDocument()
  })
})
