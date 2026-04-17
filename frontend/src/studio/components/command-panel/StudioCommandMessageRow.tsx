import { memo, useCallback, useEffect, useRef } from 'react'
import { useI18n } from '../../../i18n'
import { stripStudioReferenceImages } from '../../reference-images'
import { debugStudioMessages } from '../../agent-response/debug'
import type { StudioMessage } from '../../protocol/studio-agent-types'
import { StudioMarkdown } from '../StudioMarkdown'
import { selectRowView } from './selectors'
import type { StudioCommandPanelStore } from './store'
import { useCommandStoreSelector } from './use-command-store-selector'

interface StudioCommandMessageRowProps {
  messageId: string
  store: StudioCommandPanelStore
  variant?: 'default' | 't-layout-bottom' | 'pure-minimal-bottom'
}

const animatedMessageIds = new Set<string>()

export const StudioCommandMessageRow = memo(function StudioCommandMessageRow({
  messageId,
  store,
  variant = 'default',
}: StudioCommandMessageRowProps) {
  const selector = useCallback(
    (snapshot: ReturnType<StudioCommandPanelStore['getSnapshot']>) => selectRowView(snapshot, messageId),
    [messageId],
  )
  const rowView = useCommandStoreSelector(store, selector, areRowViewsEqual)
  const renderCountRef = useRef(0)
  const prevRowViewRef = useRef(rowView)
  const shouldAnimateEnter = !animatedMessageIds.has(messageId)

  renderCountRef.current += 1

  useEffect(() => {
    animatedMessageIds.add(messageId)
    debugStudioMessages('command-row-mounted', {
      messageId,
      role: rowView.message?.role ?? 'missing',
      shouldAnimateEnter,
    })

    return () => {
      debugStudioMessages('command-row-unmounted', {
        messageId,
      })
    }
  }, [messageId, rowView.message?.role, shouldAnimateEnter])

  useEffect(() => {
    const previous = prevRowViewRef.current
    debugStudioMessages('command-row-rendered', {
      messageId,
      renderCount: renderCountRef.current,
      role: rowView.message?.role ?? 'missing',
      changed: describeRowViewChange(previous, rowView),
      isStreamingTarget: rowView.isStreamingTarget,
      showCaret: rowView.showCaret,
      streamedLength: rowView.streamedText.length,
    })
    prevRowViewRef.current = rowView
  }, [messageId, rowView])

  if (!rowView.message) {
    return null
  }

  if (rowView.message.role === 'user') {
    return (
      <UserMessageItem
        message={rowView.message}
        shouldAnimateEnter={shouldAnimateEnter}
        minimal={variant === 'pure-minimal-bottom'}
      />
    )
  }

  return (
    <AssistantMessageItem
      message={rowView.message}
      shouldAnimateEnter={shouldAnimateEnter}
      isStreamingTarget={rowView.isStreamingTarget}
      streamedText={rowView.streamedText}
      showCaret={rowView.showCaret}
      minimal={variant === 'pure-minimal-bottom'}
    />
  )
})

const UserMessageItem = memo(function UserMessageItem({
  message,
  shouldAnimateEnter,
  minimal,
}: {
  message: Extract<StudioMessage, { role: 'user' }>
  shouldAnimateEnter: boolean
  minimal: boolean
}) {
  const { t } = useI18n()

  if (minimal) {
    return (
      <div className={`${shouldAnimateEnter ? 'animate-message-enter ' : ''}mb-1`}>
        <div className="flex items-baseline gap-4">
          <span className="block w-4 shrink-0 text-center text-[11px] font-semibold leading-loose text-accent/72">{'>'}</span>
          <StudioMarkdown
            content={stripStudioReferenceImages(message.text)}
            className="studio-markdown-inline min-w-0 flex-1 text-[13px] leading-loose text-accent/80"
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`${shouldAnimateEnter ? 'animate-message-enter ' : ''}group mb-6`}>
      <div className="rounded-2xl bg-bg-secondary/30 px-6 py-5 transition-colors group-hover:bg-bg-secondary/50">
        <div className="mb-3 flex items-center gap-3">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-accent/40">{t('studio.inputUser')}</span>
          <div className="h-px flex-1 bg-border/5" />
        </div>
        <StudioMarkdown
          content={stripStudioReferenceImages(message.text)}
          className="text-[14px] font-medium leading-7 text-text-primary/80"
        />
      </div>
    </div>
  )
})

const AssistantMessageItem = memo(function AssistantMessageItem({
  message,
  shouldAnimateEnter,
  isStreamingTarget,
  streamedText,
  showCaret,
  minimal,
}: {
  message: Extract<StudioMessage, { role: 'assistant' }>
  shouldAnimateEnter: boolean
  isStreamingTarget: boolean
  streamedText: string
  showCaret: boolean
  minimal: boolean
}) {
  const { t } = useI18n()
  const textParts = message.parts.filter((part) => part.type === 'text' || part.type === 'reasoning')
  const toolParts = message.parts.filter((part) => part.type === 'tool')
  const hasStreamedText = streamedText.length > 0
  const hasRenderableText = textParts.some((part) => part.text.trim())

  if (minimal) {
    return (
      <div className={`${!isStreamingTarget && shouldAnimateEnter ? 'animate-message-enter ' : ''}mb-1`}>
        <div className="flex items-baseline gap-4">
          <span className="block w-4 shrink-0 text-center text-[10px] font-semibold leading-loose text-accent/54">{'•'}</span>
          <div className="min-w-0 flex-1 space-y-2">
            {isStreamingTarget && hasStreamedText ? (
              <StudioMarkdown
                content={streamedText}
                className="studio-markdown-inline text-[13px] leading-loose text-accent/70"
                showCaret={showCaret}
              />
            ) : isStreamingTarget && !hasRenderableText ? (
              <div className="flex items-center gap-3">
                <span className="text-[12px] uppercase tracking-[0.2em] text-accent/40">{t('studio.thinking')}</span>
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
                <StudioMarkdown
                  key={`text-${i}`}
                  content={text}
                  className="studio-markdown-inline text-[13px] leading-loose text-accent/70"
                />
              )
            })}

            {!isStreamingTarget && !hasRenderableText && (
              <div className="text-[12px] text-accent/30">
                {t('studio.noResponseOutput')}
              </div>
            )}

            {toolParts.length > 0 && (
              <div className="space-y-1 pt-1">
                {toolParts.map((part, i) => {
                  const status = part.state.status === 'error' ? '!' : part.state.status === 'completed' ? '->' : '...'
                  const args = 'input' in part.state ? truncateArgs(part.state.input) : ''
                  return (
                    <div key={i} className="space-y-1">
                      <div className={`flex items-center gap-3 font-mono text-[10px] tracking-tight ${neutralToolTone(part.state.status)}`}>
                        <span className="w-4 shrink-0 text-center opacity-75">{status}</span>
                        <span className="uppercase tracking-[0.18em] opacity-72">{part.tool}</span>
                        <span className="truncate opacity-28">({args})</span>
                      </div>
                      {part.state.status === 'error' && (
                        <div className="pl-7 text-[11px] leading-5 text-rose-600/85 dark:text-rose-300/85 break-words">
                          {part.state.error}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${!isStreamingTarget && shouldAnimateEnter ? 'animate-message-enter ' : ''}group mb-6`}>
      <div className="rounded-2xl bg-bg-tertiary/40 px-6 py-6 transition-colors group-hover:bg-bg-tertiary/60">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-primary/45">{t('studio.outputAgent')}</span>
          <div className="h-px flex-1 bg-border/10" />
        </div>

        <div className="space-y-6">
          {isStreamingTarget && hasStreamedText ? (
            <StudioMarkdown
              content={streamedText}
              className="text-[15px] font-medium leading-8 text-text-primary/90"
              showCaret={showCaret}
            />
          ) : isStreamingTarget && !hasRenderableText ? (
            <div className="ml-1 flex items-center gap-4 border-l border-accent/10 pl-1">
              <span className="text-[13px] font-mono tracking-widest text-text-secondary/40">{t('studio.thinking')}</span>
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
              <StudioMarkdown
                key={`text-${i}`}
                content={text}
                className="text-[15px] font-medium leading-8 text-text-primary/90"
              />
            )
          })}

          {!isStreamingTarget && !hasRenderableText && (
            <div className="text-[13px] text-text-secondary/30">
              {t('studio.noResponseOutput')}
            </div>
          )}

          {toolParts.length > 0 && (
            <div className="space-y-2.5 border-t border-border/10 pt-4">
              {toolParts.map((part, i) => {
                const status = part.state.status === 'error' ? '!' : part.state.status === 'completed' ? '->' : '...'
                const args = 'input' in part.state ? truncateArgs(part.state.input) : ''
                return (
                  <div key={i} className="space-y-1.5">
                    <div className={`font-mono text-[10px] tracking-tight ${neutralToolTone(part.state.status)} flex items-center gap-3`}>
                      <span className="flex h-4 w-4 items-center justify-center bg-text-primary/5 font-bold">{status}</span>
                      <span className="font-bold uppercase tracking-wider">{part.tool}</span>
                      <span className="truncate opacity-30">({args})</span>
                    </div>
                    {part.state.status === 'error' && (
                      <div className="pl-7 text-[12px] leading-6 text-rose-600/85 dark:text-rose-300/85 break-words">
                        {part.state.error}
                      </div>
                    )}
                  </div>
                )
              })}
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

function areRowViewsEqual(
  left: ReturnType<typeof selectRowView>,
  right: ReturnType<typeof selectRowView>,
) {
  return left.message === right.message
    && left.isStreamingTarget === right.isStreamingTarget
    && left.streamedText === right.streamedText
    && left.showCaret === right.showCaret
}

function describeRowViewChange(
  previous: ReturnType<typeof selectRowView>,
  next: ReturnType<typeof selectRowView>,
) {
  const reasons: string[] = []

  if (previous.message !== next.message) {
    reasons.push('message-ref')
  }
  if (previous.isStreamingTarget !== next.isStreamingTarget) {
    reasons.push('stream-target')
  }
  if (previous.streamedText !== next.streamedText) {
    reasons.push('stream-text')
  }
  if (previous.showCaret !== next.showCaret) {
    reasons.push('caret')
  }

  return reasons.length > 0 ? reasons : ['no-diff']
}
