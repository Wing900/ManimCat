import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import type { StudioTokenUsage } from '../../protocol/studio-agent-types'
import { StudioMarkdown } from '../../components/StudioMarkdown'
import { StudioTokenUsageView } from '../../status/StudioTokenUsageView'
import {
  readStudioCinemaToolStatusKey,
  type StudioCinemaConversationRow,
  type StudioCinemaToolRow,
} from './scene-conversation-model'

/**
 * The Scene conversation, opened only by the cat (task 11C2).
 *
 * It floats above the screen instead of taking layout space, so the video keeps the maximum width and
 * the composer below stays reachable. It consumes the Scene public messages directly: no Legacy
 * message store, no raw Tool input, no internal error and no private path is rendered.
 *
 * Scrolling (correction R3):
 *
 * - following the stream is driven by the *content revision*, not by the row count: a single assistant
 *   part that keeps growing must keep pulling a bottom reader down;
 * - a reading position is stored per `(sessionId, sceneId)` and restored when the panel is re-opened
 *   or the Scene changes, so closing the history does not lose where the reader was;
 * - a reader who scrolled up is never dragged back to the bottom; only the explicit jump button does.
 */

export interface SceneHistoryPanelProps {
  id: string
  open: boolean
  /** Session + Scene identify the stored reading position. */
  sessionId: string
  sceneId: string
  /** Cheap digest of the rendered rows: changes whenever any text or Tool status grows. */
  revision: string
  title: string
  rows: readonly StudioCinemaConversationRow[]
  /** Measured token usage of this Scene's latest Run, or null when nothing was measured. */
  usage: StudioTokenUsage | null
  loading: boolean
  onClose: () => void
}

const NEAR_BOTTOM_PX = 48
/** NUL composite, the same separator the Scene state keys use: two identities can never collide. */
const SCENE_IDENTITY_SEPARATOR = '\u0000'

function SceneToolActivity({ row }: { row: StudioCinemaToolRow }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-black/10 bg-white/50 dark:border-white/10 dark:bg-white/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30"
        aria-expanded={expanded}
        disabled={!row.hasDetail}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="font-medium text-text-primary/80">{row.toolName}</span>
        <span className="text-text-secondary/60">{t(readStudioCinemaToolStatusKey(row.status))}</span>
        {row.hasDetail ? (
          <span className="ml-auto text-text-secondary/50">
            {expanded ? t('studio.cinema.toolCollapse') : t('studio.cinema.toolExpand')}
          </span>
        ) : null}
      </button>

      {expanded && row.hasDetail ? (
        <div className="space-y-1 border-t border-black/5 px-2 py-1.5 dark:border-white/10">
          {row.title ? <p className="text-[11px] text-text-primary/75">{row.title}</p> : null}
          {row.output ? (
            <p className="whitespace-pre-wrap break-words text-[11px] text-text-secondary/80">{row.output}</p>
          ) : null}
          {row.attachments.length > 0 ? (
            <ul className="space-y-0.5">
              {row.attachments.map((attachment, index) => (
                <li key={`${row.id}-attachment-${index}`} className="text-[11px] text-text-secondary/70">
                  {attachment.name ?? t('studio.cinema.toolAttachment')}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SceneHistoryRow({ row }: { row: StudioCinemaConversationRow }) {
  const { t } = useI18n()

  if (row.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl bg-accent-rgb/10 px-2.5 py-1.5">
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-text-secondary/50">
            {t('studio.cinema.roleUser')}
          </div>
          <p className="whitespace-pre-wrap break-words text-xs text-text-primary/85">{row.text}</p>
        </div>
      </div>
    )
  }

  if (row.kind === 'tool') {
    return <SceneToolActivity row={row} />
  }

  if (row.kind === 'reasoning') {
    return (
      <details className="rounded-lg border border-dashed border-black/10 px-2 py-1 text-[11px] dark:border-white/10">
        <summary className="cursor-pointer text-text-secondary/60">{t('studio.cinema.reasoningLabel')}</summary>
        <p className="mt-1 whitespace-pre-wrap break-words text-text-secondary/70">{row.text}</p>
      </details>
    )
  }

  return (
    <div className="max-w-[92%]">
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-text-secondary/50">
        {t('studio.cinema.roleAssistant')}
      </div>
      <StudioMarkdown content={row.text} className="text-xs" />
    </div>
  )
}

export function SceneHistoryPanel({
  id,
  open,
  sessionId,
  sceneId,
  revision,
  title,
  rows,
  usage,
  loading,
  onClose,
}: SceneHistoryPanelProps) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const positionsRef = useRef(new Map<string, number>())
  /** Identity whose reading position is currently restored in the mounted list. */
  const restoredIdentityRef = useRef<string | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const identity = `${sessionId}${SCENE_IDENTITY_SEPARATOR}${sceneId}`

  // A re-open and a Scene (or Session) switch restore that identity's own reading position; a growing
  // conversation never re-enters this effect because the restored identity is remembered.
  useLayoutEffect(() => {
    const element = listRef.current
    if (!open) {
      // The list is unmounted: the next open must restore again instead of assuming it is already there.
      restoredIdentityRef.current = null
      return
    }
    if (!element || restoredIdentityRef.current === identity) {
      return
    }
    restoredIdentityRef.current = identity
    const saved = positionsRef.current.get(identity)
    element.scrollTop = saved ?? element.scrollHeight
    atBottomRef.current =
      saved === undefined || element.scrollHeight - saved - element.clientHeight < NEAR_BOTTOM_PX
    setShowJumpToLatest(!atBottomRef.current)
  }, [identity, open, revision])

  // Streaming follows the bottom only for a user who is already there. The dependency is the content
  // revision, so a part that grows without adding a row still keeps the bottom reader at the bottom.
  useLayoutEffect(() => {
    const element = listRef.current
    if (!open || !element || !atBottomRef.current) {
      return
    }
    element.scrollTop = element.scrollHeight
    // Keep the stored position honest: a follow is a position too.
    positionsRef.current.set(identity, element.scrollTop)
  }, [identity, open, revision])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  const jumpToLatest = () => {
    const element = listRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
      atBottomRef.current = true
      positionsRef.current.set(identity, element.scrollTop)
      setShowJumpToLatest(false)
    }
  }

  return (
    <section
      id={id}
      role="dialog"
      aria-label={title}
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[60%] flex-col overflow-hidden rounded-xl border border-black/10 bg-bg-primary/95 shadow-lg backdrop-blur lg:left-3 lg:right-auto lg:w-[420px] dark:border-white/15"
    >
      <header className="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary/85">{title}</h2>
        <button
          type="button"
          className="rounded-md border border-black/10 px-2 py-0.5 text-[11px] text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
          onClick={onClose}
          aria-label={t('studio.cinema.historyClose')}
        >
          {t('studio.cinema.historyClose')}
        </button>
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
        onScroll={(event) => {
          const element = event.currentTarget
          atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX
          setShowJumpToLatest(!atBottomRef.current)
          positionsRef.current.set(identity, element.scrollTop)
        }}
      >
        {loading && rows.length === 0 ? (
          <p className="text-[11px] text-text-secondary/60">{t('studio.cinema.historyLoading')}</p>
        ) : null}
        {!loading && rows.length === 0 ? (
          <p className="text-[11px] text-text-secondary/60">{t('studio.cinema.historyEmpty')}</p>
        ) : null}
        {rows.map((row) => (
          <SceneHistoryRow key={row.id} row={row} />
        ))}
      </div>

      {usage ? (
        <div className="border-t border-black/5 px-3 dark:border-white/10">
          <StudioTokenUsageView usage={usage} />
        </div>
      ) : null}

      {showJumpToLatest ? (
        <button
          type="button"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-black/10 bg-white/90 px-3 py-1 text-[11px] text-text-secondary shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15 dark:bg-black/60"
          onClick={jumpToLatest}
        >
          {t('studio.cinema.jumpToLatest')}
        </button>
      ) : null}
    </section>
  )
}
