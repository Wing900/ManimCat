import { useState } from 'react'
import type { StudioMessage, StudioSession } from '../protocol/studio-agent-types'
import { formatStudioTime, studioPanelClass, studioStatusBadge, truncateStudioText } from '../theme'

interface StudioRunComposerProps {
  session: StudioSession | null
  messages: StudioMessage[]
  disabled: boolean
  onRun: (inputText: string) => Promise<void> | void
  onRefresh: () => Promise<void> | void
  onExit: () => void
}

export function StudioRunComposer({ session, messages, disabled, onRun, onRefresh, onExit }: StudioRunComposerProps) {
  const [input, setInput] = useState('')

  const handleSubmit = async () => {
    const next = input.trim()
    if (!next || disabled) {
      return
    }
    setInput('')
    await onRun(next)
  }

  return (
    <section className={studioPanelClass('flex h-full flex-col p-4')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-text-secondary">Command Area</div>
          <h2 className="mt-2 text-xl font-semibold text-text-primary">{session?.title ?? 'Studio booting'}</h2>
          <div className="mt-1 text-sm text-text-secondary">{session?.directory ?? 'Loading workspace directory...'}</div>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-full border border-black/10 px-3 py-1.5 text-sm text-text-secondary transition hover:border-black/20 hover:text-text-primary dark:border-white/10"
        >
          Exit
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioStatusBadge(session?.agentType ?? 'idle')}`}>
            {session?.agentType ?? 'builder'}
          </span>
          <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-text-secondary ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/10">
            {session?.permissionLevel ?? 'L2'}
          </span>
        </div>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="描述你要 builder 执行的工作，例如：review src/studio-agent/runtime，重点看状态同步和错误恢复。"
          className="mt-3 h-32 w-full resize-none rounded-2xl border border-black/10 bg-white/90 px-4 py-3 text-sm text-text-primary outline-none transition focus:border-black/30 dark:border-white/10 dark:bg-black/20"
        />
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleSubmit()}
            className="rounded-full bg-text-primary px-4 py-2 text-sm font-medium text-bg-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run
          </button>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="rounded-full border border-black/10 px-4 py-2 text-sm text-text-secondary transition hover:border-black/20 hover:text-text-primary dark:border-white/10"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-auto">
        <div className="mb-3 text-xs uppercase tracking-[0.28em] text-text-secondary">Conversation</div>
        <div className="space-y-3">
          {messages.slice(-8).map((message) => (
            <article
              key={message.id}
              className={`rounded-2xl border p-3 ${
                message.role === 'user'
                  ? 'border-black/10 bg-white/90 dark:border-white/10 dark:bg-black/20'
                  : 'border-sky-500/10 bg-sky-500/5 dark:border-sky-400/20 dark:bg-sky-400/10'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-[0.24em] text-text-secondary">{message.role}</span>
                <span className="text-xs text-text-secondary">{formatStudioTime(message.createdAt)}</span>
              </div>
              <div className="mt-2 text-sm leading-6 text-text-primary">{truncateStudioText(resolveMessageText(message), 240)}</div>
            </article>
          ))}
          {messages.length === 0 && <div className="text-sm text-text-secondary">Session messages will appear here after the first run.</div>}
        </div>
      </div>
    </section>
  )
}

function resolveMessageText(message: StudioMessage): string {
  if (message.role === 'user') {
    return message.text
  }

  return message.parts
    .filter((part) => part.type === 'text' || part.type === 'reasoning')
    .map((part) => part.text)
    .join('\n')
}
