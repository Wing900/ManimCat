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
}

const animatedMessageIds = new Set<string>()

export const StudioCommandMessageRow = memo(function StudioCommandMessageRow({
  messageId,
  store,
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
    return <UserMessageItem message={rowView.message} shouldAnimateEnter={shouldAnimateEnter} />
  }

  return (
    <AssistantMessageItem
      message={rowView.message}
      shouldAnimateEnter={shouldAnimateEnter}
      isStreamingTarget={rowView.isStreamingTarget}
      streamedText={rowView.streamedText}
      showCaret={rowView.showCaret}
    />
  )
})

const UserMessageItem = memo(function UserMessageItem({
  message,
  shouldAnimateEnter,
}: {
  message: Extract<StudioMessage, { role: 'user' }>
  shouldAnimateEnter: boolean
}) {
  const { t } = useI18n()
  return (
    <div className={`${shouldAnimateEnter ? 'animate-message-enter ' : ''}group`}>
      <div className="rounded-2xl bg-bg-secondary/20 px-6 py-5 transition-colors group-hover:bg-bg-secondary/40">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary/35">{t('studio.inputUser')}</span>
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
}: {
  message: Extract<StudioMessage, { role: 'assistant' }>
  shouldAnimateEnter: boolean
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
    <div className={`${!isStreamingTarget && shouldAnimateEnter ? 'animate-message-enter ' : ''}group`}>
      <div className="rounded-2xl bg-bg-tertiary/40 px-6 py-6 transition-colors group-hover:bg-bg-tertiary/60">
        <div className="mb-5 flex items-center gap-3">
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
            <div className="flex items-center gap-4 border-l border-accent-rgb/10 pl-1 ml-1">
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
                  <div key={i} className={`font-mono text-[10px] tracking-tight ${neutralToolTone(part.state.status)} flex items-center gap-3`}>
                    <span className="flex h-4 w-4 items-center justify-center bg-text-primary/5 font-bold">{status}</span>
                    <span className="font-bold uppercase tracking-wider">{part.tool}</span>
                    <span className="truncate opacity-30">({args})</span>
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
