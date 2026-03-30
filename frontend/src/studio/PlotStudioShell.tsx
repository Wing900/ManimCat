import { useEffect, useMemo, useState } from 'react'
import { StudioPermissionModeModal } from './controls/StudioPermissionModeModal'
import { StudioCommandPanel } from './components/StudioCommandPanel'
import { useStudioSession } from './hooks/use-studio-session'
import { PlotPreviewPanel } from './plot/PlotPreviewPanel'

interface PlotStudioShellProps {
  onExit: () => void
  isExiting?: boolean
}

export function PlotStudioShell({ onExit, isExiting }: PlotStudioShellProps) {
  const studio = useStudioSession({
    studioKind: 'plot',
    title: 'Plot Studio'
  })
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const [orderedWorkIds, setOrderedWorkIds] = useState<string[]>([])
  const incomingIds = studio.workSummaries.map((entry) => entry.work.id)
  const incomingIdsKey = incomingIds.join('|')

  useEffect(() => {
    setOrderedWorkIds((current) => {
      const preserved = current.filter((id) => incomingIds.includes(id))
      const appended = incomingIds.filter((id) => !preserved.includes(id))
      const next = [...appended, ...preserved]
      return areSameIds(current, next) ? current : next
    })
  }, [incomingIdsKey])

  const orderedWorkSummaries = useMemo(() => {
    const byId = new Map(studio.workSummaries.map((entry) => [entry.work.id, entry]))
    return orderedWorkIds
      .map((id) => byId.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  }, [orderedWorkIds, studio.workSummaries])

  const latestWorkId = orderedWorkSummaries[0]?.work.id ?? null

  useEffect(() => {
    if (!latestWorkId) {
      return
    }

    setSelectedWorkId((current) => (current === latestWorkId ? current : latestWorkId))
  }, [latestWorkId])

  const effectiveSelectedWorkId =
    selectedWorkId && orderedWorkSummaries.some((entry) => entry.work.id === selectedWorkId)
      ? selectedWorkId
      : orderedWorkSummaries[0]?.work.id ?? null
  const selected = studio.selectWork(effectiveSelectedWorkId)

  const handleReorderWorks = (nextWorkIds: string[]) => {
    setOrderedWorkIds((current) => (areSameIds(current, nextWorkIds) ? current : nextWorkIds))
  }

  return (
    <>
      <div
        className={`h-screen overflow-hidden bg-bg-primary text-text-primary studio-shell-root ${
          isExiting ? 'animate-studio-exit' : 'animate-studio-entrance'
        }`}
      >
        <div className="relative h-screen overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 flex-col xl:flex-row">
            <div className="relative min-h-0 border-b border-border/4 xl:w-[36%] xl:min-w-[360px] xl:max-w-[500px] xl:border-b-0 xl:border-r xl:border-border/5">
              <StudioCommandPanel
                session={studio.session}
                messages={studio.messages}
                latestAssistantText={studio.latestAssistantText}
                isBusy={studio.isBusy}
                disabled={studio.isBusy || studio.state.connection.snapshotStatus !== 'ready'}
                onRun={studio.runCommand}
                onExit={onExit}
              />
            </div>

            <div className="min-h-0 min-w-0 flex-1">
              <PlotPreviewPanel
                session={studio.session}
                works={orderedWorkSummaries}
                selectedWorkId={effectiveSelectedWorkId}
                work={selected.work}
                result={selected.result}
                latestRun={studio.latestRun}
                tasks={selected.tasks}
                requests={studio.pendingPermissions}
                replyingPermissionIds={studio.replyingPermissionIds}
                latestAssistantText={studio.latestAssistantText}
                errorMessage={studio.state.error ?? studio.state.connection.eventError}
                onSelectWork={setSelectedWorkId}
                onReorderWorks={handleReorderWorks}
                onReply={studio.replyPermission}
              />
            </div>
          </div>
        </div>
      </div>

      <StudioPermissionModeModal {...studio.permissionModeModal} />
    </>
  )
}

function areSameIds(left: string[], right: string[]) {
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
