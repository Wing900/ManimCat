import { memo, useEffect, useRef, useState } from 'react'
import type { StudioMessage, StudioSession } from '../protocol/studio-agent-types'
import { useI18n } from '../../i18n'

interface StudioCommandPanelProps {
  session: StudioSession | null
  messages: StudioMessage[]
  latestAssistantText: string
  isBusy: boolean
  disabled: boolean
  onRun: (inputText: string) => Promise<void> | void
  onExit: () => void
}

export function StudioCommandPanel({
  session,
  messages,
  latestAssistantText,
  isBusy,
  disabled,
  onRun,
  onExit,
}: StudioCommandPanelProps) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [animatedAssistantText, setAnimatedAssistantText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const streamRateRef = useRef(0)
  const latestTextMetaRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const lastScrollSignatureRef = useRef('')

  const handleSubmit = async () => {
    const next = input.trim()
    if (!next || disabled) {
      return
    }
    setInput('')
    try {
      await onRun(next)
    } catch {
      setInput(next)
    }
    inputRef.current?.focus()
  }

  const focusInput = () => {
    if (disabled) {
      return
    }
    inputRef.current?.focus()
  }

  const lastMessage = messages.at(-1) ?? null
  const streamIntoLastAssistant =
    Boolean(lastMessage && lastMessage.role === 'assistant' && (isBusy || latestAssistantText || animatedAssistantText))

  useEffect(() => {
    const signature = [
      messages.length,
      lastMessage?.id ?? '',
      latestAssistantText.length,
      isBusy ? 'busy' : 'idle',
    ].join(':')

    if (signature === lastScrollSignatureRef.current) {
      return
    }

    lastScrollSignatureRef.current = signature
    if (typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ block: 'end' })
    }
  }, [isBusy, lastMessage?.id, latestAssistantText.length, messages.length])

  useEffect(() => {
    if (!disabled) {
      focusInput()
    }
  }, [disabled, session?.id])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target?.isContentEditable
      ) {
        return
      }

      if (!shouldRedirectKeyToInput(event)) {
        return
      }

      focusInput()
      if (event.key === 'Backspace') {
        setInput((current) => current.slice(0, -1))
        event.preventDefault()
        return
      }

      if (event.key.length === 1) {
        setInput((current) => `${current}${event.key}`)
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [disabled])

  useEffect(() => {
    if (!latestAssistantText) {
      streamRateRef.current = 0
      latestTextMetaRef.current = { text: '', at: 0 }
      const frame = window.requestAnimationFrame(() => {
        setAnimatedAssistantText('')
      })
      return () => window.cancelAnimationFrame(frame)
    }

    const now = Date.now()
    const prev = latestTextMetaRef.current
    if (prev.text && latestAssistantText.startsWith(prev.text) && latestAssistantText.length > prev.text.length) {
      const deltaChars = latestAssistantText.length - prev.text.length
      const deltaMs = Math.max(1, now - prev.at)
      const charsPerSecond = (deltaChars * 1000) / deltaMs
      streamRateRef.current = streamRateRef.current === 0
        ? charsPerSecond
        : streamRateRef.current * 0.68 + charsPerSecond * 0.32
    } else if (!prev.text) {
      streamRateRef.current = 0
    }
    latestTextMetaRef.current = { text: latestAssistantText, at: now }

    const frame = window.requestAnimationFrame(() => {
      setAnimatedAssistantText((current) => {
        if (!latestAssistantText.startsWith(current)) {
          return latestAssistantText.slice(0, 1)
        }
        return current || latestAssistantText.slice(0, 1)
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [latestAssistantText])

  useEffect(() => {
    if (!latestAssistantText) {
      return
    }

    if (animatedAssistantText === latestAssistantText) {
      return
    }

    const timer = window.setTimeout(() => {
      setAnimatedAssistantText((current) => {
        if (!latestAssistantText.startsWith(current)) {
          return latestAssistantText.slice(0, 1)
        }

        const nextLength = current.length + nextTypeStep(latestAssistantText.length - current.length)
        return latestAssistantText.slice(0, nextLength)
      })
    }, nextTypeDelay(latestAssistantText, animatedAssistantText.length, streamRateRef.current))

    return () => window.clearTimeout(timer)
  }, [animatedAssistantText, latestAssistantText])

  return (
    <section className="studio-terminal flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg-primary/20 backdrop-blur-md">
      <header className="shrink-0 flex items-center justify-between gap-4 border-b border-border/5 px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-accent-rgb/20 animate-pulse" />
          <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-text-primary/70">
            {session?.title ?? t('studio.title')}
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-full border border-border/10 px-4 py-1.5 text-[11px] uppercase tracking-widest text-text-secondary/50 transition hover:bg-rose-500/10 hover:text-rose-500/80"
        >
          {t('common.close')}
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-10">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-30">
            <div className="mb-4 text-3xl">🐾</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.4em]">{t('studio.readyForCommands')}</div>
          </div>
        )}

        <div className="flex flex-col space-y-12">
          {messages.map((message) => {
            if (message.role === 'user') {
              return (
                <UserMessageItem key={message.id} message={message} />
              )
            }

            const isStreamingTarget = streamIntoLastAssistant && lastMessage?.id === message.id
            return (
              <AssistantMessageItem
                key={message.id}
                message={message}
                isStreamingTarget={isStreamingTarget}
                streamedText={animatedAssistantText}
                showCaret={Boolean(isStreamingTarget && (isBusy || latestAssistantText !== animatedAssistantText))}
              />
            )
          })}

          <div ref={endRef} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-border/5 bg-bg-primary/30 px-8 py-6 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-text-secondary/40 tracking-widest">{'>'}</span>
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
            placeholder={disabled ? t('studio.initializing') : t('studio.commandPlaceholder')}
            disabled={false}
            aria-disabled={disabled}
            className="flex-1 bg-transparent text-[14px] font-medium leading-relaxed text-text-primary outline-none placeholder:text-text-secondary/25"
          />
          <div className="flex items-center gap-2 opacity-30">
             <div className="font-mono text-[9px] uppercase tracking-widest text-text-secondary">{t('studio.enterToSend')}</div>
          </div>
        </div>
      </footer>
    </section>
  )
}

const UserMessageItem = memo(function UserMessageItem({
  message,
}: {
  message: Extract<StudioMessage, { role: 'user' }>
}) {
  const { t } = useI18n()
  return (
    <div className="animate-fade-in-soft group">
      <div className="rounded-2xl bg-bg-secondary/20 px-6 py-5 transition-colors group-hover:bg-bg-secondary/40">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary/35">{t('studio.inputUser')}</span>
          <div className="h-px flex-1 bg-border/5" />
        </div>
        <div className="text-[14px] font-medium leading-7 text-text-primary/80">
          <div className="whitespace-pre-wrap break-words">{message.text}</div>
        </div>
      </div>
    </div>
  )
})

const AssistantMessageItem = memo(function AssistantMessageItem({
  message,
  isStreamingTarget,
  streamedText,
  showCaret,
}: {
  message: Extract<StudioMessage, { role: 'assistant' }>
  isStreamingTarget: boolean
  streamedText: string
  showCaret: boolean
}) {
  const { t } = useI18n()
  const textParts = message.parts.filter((part) => part.type === 'text' || part.type === 'reasoning')
  const toolParts = message.parts.filter((part) => part.type === 'tool')
  const hasStreamedText = streamedText.length > 0
  const hasRenderableText = textParts.some((part) => part.text.trim())

  return (
    <div className={`${isStreamingTarget ? '' : 'animate-fade-in-soft '}group`}>
      <div className="rounded-2xl bg-bg-tertiary/40 px-6 py-6 transition-colors group-hover:bg-bg-tertiary/60">
        <div className="mb-5 flex items-center gap-3">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-primary/45">{t('studio.outputAgent')}</span>
          <div className="h-px flex-1 bg-border/10" />
        </div>
        
        <div className="space-y-6">
          {toolParts.length > 0 && (
            <div className="mb-4 space-y-2.5">
              {toolParts.map((part, i) => {
                const status = part.state.status === 'error' ? '!' : part.state.status === 'completed' ? '->' : '...'
                const args = 'input' in part.state ? truncateArgs(part.state.input) : ''
                return (
                  <div key={i} className={`font-mono text-[10px] tracking-tight ${neutralToolTone(part.state.status)} flex items-center gap-3`}>
                    <span className="flex h-4 w-4 items-center justify-center bg-text-primary/5 font-bold">{status}</span>
                    <span className="font-bold uppercase tracking-wider">{part.tool}</span>
                    <span className="truncate opacity-30">({args})</span>
                  </div>
                )
              })}
            </div>
          )}

          {isStreamingTarget && hasStreamedText ? (
            <div className="text-[15px] font-medium leading-8 text-text-primary/90 whitespace-pre-wrap break-words">
              {streamedText}
              {showCaret && <span className="studio-type-caret opacity-30">█</span>}
            </div>
          ) : isStreamingTarget && !hasRenderableText ? (
            <div className="flex items-center gap-4 border-l border-accent-rgb/10 pl-1 ml-1">
              <span className="text-[13px] font-mono tracking-widest text-text-secondary/40 italic">{t('common.loading')}</span>
              <span className="studio-thinking-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : textParts.map((part, i) => {
            const text = part.text.trim()
            if (!text) return null
            return (
              <div key={`text-${i}`} className="text-[15px] font-medium leading-8 text-text-primary/90 whitespace-pre-wrap">
                {text}
              </div>
            )
          })}

          {!isStreamingTarget && !hasRenderableText && (
            <div className="text-[13px] italic text-text-secondary/30">
              {t('studio.noResponseOutput')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

function neutralToolTone(status: string) {
  switch (status) {
    case 'error':
      return 'text-rose-500/70'
    case 'completed':
      return 'text-text-primary/40'
    default:
      return 'text-amber-500/70'
  }
}

function truncateArgs(input?: Record<string, unknown>) {
  if (!input) return ''
  const str = JSON.stringify(input)
  return str.length > 60 ? `${str.slice(0, 57)}...` : str
}

function nextTypeDelay(target: string, currentLength: number, streamRate: number) {
  const nextChar = target[currentLength] ?? ''
  const backlog = target.length - currentLength
  const targetCharsPerSecond = resolveTypingCharsPerSecond(backlog, streamRate)
  if (!nextChar) {
    return 18
  }

  if (nextChar === '\n') {
    return 1000 / Math.max(targetCharsPerSecond * 1.4, 1)
  }

  if (/[，。！？；：,.!?;:]/.test(nextChar)) {
    return Math.max(24, 1000 / Math.max(targetCharsPerSecond * 0.55, 1))
  }

  if (/\s/.test(nextChar)) {
    return Math.max(10, 1000 / Math.max(targetCharsPerSecond * 1.25, 1))
  }

  return Math.max(12, 1000 / Math.max(targetCharsPerSecond, 1))
}

function nextTypeStep(backlog: number) {
  if (backlog >= 28) {
    return 3
  }

  if (backlog >= 16) {
    return 2
  }

  return 1
}

function resolveTypingCharsPerSecond(backlog: number, streamRate: number) {
  const minCharsPerSecond = 10
  const maxCharsPerSecond = 26
  const adaptiveBase = streamRate > 0 ? streamRate * 0.55 + 6 : minCharsPerSecond

  if (backlog >= 10) {
    return clamp(adaptiveBase, 12, maxCharsPerSecond)
  }

  return clamp(adaptiveBase, minCharsPerSecond, 18)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function shouldRedirectKeyToInput(event: KeyboardEvent): boolean {
  return event.key.length === 1 || event.key === 'Backspace'
}
