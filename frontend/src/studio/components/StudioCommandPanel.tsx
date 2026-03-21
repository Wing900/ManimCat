import { useEffect, useRef, useState } from 'react'
import type { StudioMessage, StudioSession } from '../protocol/studio-agent-types'
import { formatStudioTime } from '../theme'

interface StudioCommandPanelProps {
  session: StudioSession | null
  messages: StudioMessage[]
  disabled: boolean
  onRun: (inputText: string) => Promise<void> | void
  onExit: () => void
}

export function StudioCommandPanel({
  session,
  messages,
  disabled,
  onRun,
  onExit,
}: StudioCommandPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    const next = input.trim()
    if (!next || disabled) {
      return
    }
    setInput('')
    await onRun(next)
    inputRef.current?.focus()
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus()
    }
  }, [disabled, session?.id])

  return (
    <section className="studio-terminal flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg-primary/30 shadow-[inset_0_0_40px_rgba(0,0,0,0.02)]">
      <header className="shrink-0 flex items-center justify-between gap-4 border-b border-border/10 px-8 py-4">
        <div className="font-mono text-sm text-text-secondary/60">
          {session?.directory ?? '...'}
        </div>
        <button
          type="button"
          onClick={onExit}
          className="px-4 py-2 text-sm text-text-secondary/60 transition hover:text-rose-500/80"
        >
          退出
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {messages.length === 0 && (
          <div className="text-base leading-7 text-text-secondary/55">
            等待指令...<span className="studio-cursor">█</span>
          </div>
        )}

        <div className="flex flex-col gap-5">
          {messages.map((message) => {
            const isUser = message.role === 'user'

            if (isUser) {
              return (
                <div key={message.id} className="py-1">
                  <span className="text-[15px] leading-7 text-text-primary">
                    <span className="font-mono text-text-secondary/55">$ </span>
                    {message.text}
                  </span>
                  <span className="ml-3 text-xs text-text-secondary/45">{formatStudioTime(message.createdAt)}</span>
                </div>
              )
            }

            const parts = message.role === 'assistant' ? message.parts : []
            return (
              <div key={message.id} className="py-1">
                {parts.map((part, i) => {
                  if (part.type === 'tool') {
                    const status = part.state.status === 'error' ? '✗' : part.state.status === 'completed' ? '✓' : '…'
                    const args = 'input' in part.state ? truncateArgs(part.state.input) : ''
                    return (
                      <div key={i} className={`font-mono text-[13px] leading-6 ${toolCallTone(part.state.status)}`}>
                        {'→ '}{part.tool}({args}) <span className={toolCallStatusTone(part.state.status)}>{status}</span>
                      </div>
                    )
                  }

                  if (part.type === 'text' || part.type === 'reasoning') {
                    const text = part.text.trim()
                    if (!text) return null
                    return (
                      <div key={i} className="text-[15px] leading-7 text-text-primary whitespace-pre-wrap">
                        {text.split('\n').map((line, j) => (
                          <div key={j}>
                            <span className="font-mono text-text-secondary/50">{'>'} </span>
                            <span>{line}</span>
                          </div>
                        ))}
                      </div>
                    )
                  }

                  return null
                })}

                {parts.filter((p) => p.type === 'text' || p.type === 'reasoning').every((p) => !p.text.trim()) && (
                  <div className="text-[15px] leading-7 text-text-secondary/60">
                    <span className="font-mono text-text-secondary/50">{'>'} </span>
                    <span>(无文本输出)</span>
                  </div>
                )}

                <span className="text-xs text-text-secondary/45">{formatStudioTime(message.createdAt)}</span>
              </div>
            )
          })}

          {messages.length > 0 && disabled && (
            <div className="py-1 text-text-secondary/55">
              <span className="studio-cursor">█</span>
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border/10 px-8 py-5">
        <div className="flex items-center">
          <span className="mr-2 font-mono text-base text-text-secondary/55">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder={disabled ? '初始化中...' : '输入指令...'}
            disabled={disabled}
            className="flex-1 bg-transparent text-[15px] leading-7 text-text-primary outline-none placeholder:text-text-secondary/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="mt-3 text-xs text-text-secondary/45">Enter 发送</div>
      </footer>
    </section>
  )
}

function truncateArgs(input?: Record<string, unknown>) {
  if (!input) return ''
  const str = JSON.stringify(input)
  return str.length > 60 ? `${str.slice(0, 57)}...` : str
}

function toolCallTone(status: string) {
  switch (status) {
    case 'error':
      return 'text-rose-600 dark:text-rose-300'
    case 'completed':
      return 'text-cyan-700 dark:text-cyan-300'
    default:
      return 'text-amber-700 dark:text-amber-300'
  }
}

function toolCallStatusTone(status: string) {
  switch (status) {
    case 'error':
      return 'text-rose-500 dark:text-rose-300'
    case 'completed':
      return 'text-emerald-600 dark:text-emerald-300'
    default:
      return 'text-amber-600 dark:text-amber-300'
  }
}
