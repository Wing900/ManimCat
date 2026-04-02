import { memo, useCallback, useEffect, useRef, type RefObject } from 'react'
import { debugStudioMessages } from '../../agent-response/debug'
import { useCommandStoreSelector } from './use-command-store-selector'
import { selectVisibleMessageIds } from './selectors'
import type { StudioCommandPanelStore } from './store'
import { StudioCommandMessageRow } from './StudioCommandMessageRow'

interface StudioCommandMessageListProps {
  store: StudioCommandPanelStore
  endRef: RefObject<HTMLDivElement | null>
  variant?: 'default' | 't-layout-bottom' | 'pure-minimal-bottom'
}

export const StudioCommandMessageList = memo(function StudioCommandMessageList({
  store,
  endRef,
  variant = 'default',
}: StudioCommandMessageListProps) {
  const selectIds = useCallback(
    (snapshot: ReturnType<StudioCommandPanelStore['getSnapshot']>) => selectVisibleMessageIds(snapshot),
    [],
  )
  const visibleMessageIds = useCommandStoreSelector(store, selectIds, areIdListsEqual)
  const prevIdsRef = useRef<string[]>([])

  useEffect(() => {
    const previousIds = prevIdsRef.current
    const added = visibleMessageIds.filter((id) => !previousIds.includes(id))
    const removed = previousIds.filter((id) => !visibleMessageIds.includes(id))

    debugStudioMessages('command-list-update', {
      total: visibleMessageIds.length,
      ids: visibleMessageIds,
      sameReference: previousIds === visibleMessageIds,
      changed: !areIdListsEqual(previousIds, visibleMessageIds),
      added,
      removed,
    })

    prevIdsRef.current = visibleMessageIds
  }, [visibleMessageIds])

  return (
    <div
      className={`flex ${variant === 'pure-minimal-bottom'
        ? 'flex-col gap-0 pb-4'
        : 'flex-col space-y-12'}`}
    >
      {visibleMessageIds.map((messageId) => (
        <StudioCommandMessageRow
          key={messageId}
          messageId={messageId}
          store={store}
          variant={variant}
        />
      ))}

      <div ref={endRef} />
    </div>
  )
})

function areIdListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}
