import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import { StudioMarkdown } from '../../components/StudioMarkdown'
import {
  readStudioCinemaToolStatusKey,
  type StudioCinemaConversationRow,
  type StudioCinemaToolRow,
} from './scene-conversation-model'
import { CatCharacter, type CatPose } from './CatCharacter'
import { CloseIcon } from './CinemaIcons'

/**
 * The Scene conversation, opened only by the cat (task 11C2, doc §8).
 *
 * Desktop (lg+): an in-flow right sidebar at full height, non-modal — the stage and composer re-centre
 * in the remaining area (the workspace places this panel as a flex sibling). Narrow: a modal overlay
 * with a backdrop, focus constrained and background interaction blocked. The semantics match the
 * layout: the same `role="dialog"` carries both, with `aria-modal` only on the overlay.
 *
 * It consumes the Scene public messages directly: no Legacy message store, no raw Tool input, no
 * internal error and no private path is rendered.
 *
 * Scrolling (correction R3) is unchanged: following the stream is driven by the *content revision*,
 * a reading position is stored per `(sessionId, sceneId)` and restored on re-open or Scene switch,
 * and a reader who scrolled up is never dragged back — only the explicit jump button does.
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
  loading: boolean
  /** True while a Run is active but the assistant has produced no text yet (doc §7.1). */
  pendingReply?: boolean
  onClose: () => void
  /** Pose of the cat that moved into the header (doc §3.2). */
  catPose?: CatPose
  /** True when the panel renders as a modal overlay (narrow screens); false when it is an in-flow desktop sidebar. */
  modal?: boolean
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
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30"
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
        <div className="space-y-1 border-t border-black/5 px-2.5 py-2 dark:border-white/10">
          {row.title ? <p className="text-sm text-text-primary/75">{row.title}</p> : null}
          {row.output ? (
            <p className="whitespace-pre-wrap break-words text-sm text-text-secondary/80">{row.output}</p>
          ) : null}
          {row.attachments.length > 0 ? (
            <ul className="space-y-0.5">
              {row.attachments.map((attachment, index) => (
                <li key={`${row.id}-attachment-${index}`} className="text-sm text-text-secondary/70">
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
        <div className="max-w-[85%] rounded-2xl bg-bg-tertiary/60 px-3 py-2">
          <div className="mb-0.5 text-xs uppercase tracking-wide text-text-secondary/50">
            {t('studio.cinema.roleUser')}
          </div>
          <p className="whitespace-pre-wrap break-words text-base text-text-primary/85">{row.text}</p>
        </div>
      </div>
    )
  }

  if (row.kind === 'tool') {
    return <SceneToolActivity row={row} />
  }

  if (row.kind === 'reasoning') {
    return (
      <details className="rounded-lg border border-dashed border-black/10 px-2.5 py-1.5 text-sm dark:border-white/10">
        <summary className="cursor-pointer text-text-secondary/60">{t('studio.cinema.reasoningLabel')}</summary>
        <p className="mt-1 whitespace-pre-wrap break-words text-text-secondary/70">{row.text}</p>
      </details>
    )
  }

  return (
    <div className="max-w-[92%]">
      <div className="mb-0.5 text-xs uppercase tracking-wide text-text-secondary/50">
        {t('studio.cinema.roleAssistant')}
      </div>
      <StudioMarkdown content={row.text} className="text-base leading-relaxed" />
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
  loading,
  pendingReply = false,
  onClose,
  catPose = 'idle',
  modal = false,
}: SceneHistoryPanelProps) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement | null>(null)
  const asideRef = useRef<HTMLElement | null>(null)
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

  // Focus trap (doc §8): in the modal overlay, Tab cycles within the dialog and never reaches the
  // inert background. The desktop sidebar is non-modal, so it does not trap.
  useEffect(() => {
    if (!open || !modal) {
      return
    }
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return
      }
      const root = asideRef.current
      if (!root) {
        return
      }
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>('button, [href], textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) {
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onTab)
    return () => window.removeEventListener('keydown', onTab)
  }, [open, modal])

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
    <>
      {/* Narrow screens only: a backdrop blocks background interaction and closes on outside click. */}
      <button
        type="button"
        className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        aria-label={t('studio.cinema.sidebarBackdrop')}
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        id={id}
        role="dialog"
        aria-label={title}
        aria-modal={modal ? 'true' : undefined}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col overflow-hidden border-l border-black/10 bg-bg-primary shadow-2xl lg:static lg:z-auto lg:w-[400px] lg:max-w-none lg:border-l lg:border-black/10 lg:shadow-none dark:border-white/15"
      >
        <header className="flex items-center gap-2 border-b border-black/5 px-3 py-3 dark:border-white/10">
          <CatCharacter pose={catPose} className="cinema-cat-enter h-10 w-10 shrink-0" />
          <h2 className="min-w-0 flex-1 truncate text-base font-medium text-text-primary/85">{title}</h2>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-secondary/70 transition-all hover:bg-bg-secondary/50 hover:text-text-secondary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30"
            onClick={onClose}
            aria-label={t('studio.cinema.historyClose')}
            title={t('studio.cinema.historyClose')}
          >
            <CloseIcon />
          </button>
        </header>

        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
          onScroll={(event) => {
            const element = event.currentTarget
            atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX
            setShowJumpToLatest(!atBottomRef.current)
            positionsRef.current.set(identity, element.scrollTop)
          }}
        >
          {loading && rows.length === 0 ? (
            <p className="text-sm text-text-secondary/60">{t('studio.cinema.historyLoading')}</p>
          ) : null}
          {!loading && rows.length === 0 ? (
            <p className="text-sm text-text-secondary/60">{t('studio.cinema.historyEmpty')}</p>
          ) : null}
          {rows.map((row) => (
            <div key={row.id} className="cinema-row-enter">
              <SceneHistoryRow row={row} />
            </div>
          ))}
          {pendingReply ? (
            <div className="flex items-center gap-1.5 text-sm text-text-secondary/60" role="status">
              <span className="cinema-thinking-dot h-1.5 w-1.5 rounded-full bg-text-secondary/50" />
              <span className="cinema-thinking-dot h-1.5 w-1.5 rounded-full bg-text-secondary/50" />
              <span className="cinema-thinking-dot h-1.5 w-1.5 rounded-full bg-text-secondary/50" />
              <span className="ml-1">{t('studio.cinema.thinking')}</span>
            </div>
          ) : null}
        </div>

        {showJumpToLatest ? (
          <button
            type="button"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-black/10 bg-bg-primary/95 px-3 py-1.5 text-sm text-text-secondary shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rgb/30 dark:border-white/15"
            onClick={jumpToLatest}
          >
            {t('studio.cinema.jumpToLatest')}
          </button>
        ) : null}
      </aside>
    </>
  )
}