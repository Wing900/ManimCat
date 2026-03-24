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

  useEffect(() => {
    const incomingIds = studio.workSummaries.map((entry) => entry.work.id)
    setOrderedWorkIds((current) => {
      const preserved = current.filter((id) => incomingIds.includes(id))
      const appended = incomingIds.filter((id) => !preserved.includes(id))
      return [...appended, ...preserved]
    })
  }, [studio.workSummaries])

  const orderedWorkSummaries = useMemo(() => {
    const byId = new Map(studio.workSummaries.map((entry) => [entry.work.id, entry]))
    return orderedWorkIds
      .map((id) => byId.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  }, [orderedWorkIds, studio.workSummaries])

  useEffect(() => {
    const latestWorkId = orderedWorkSummaries[0]?.work.id ?? null
    if (latestWorkId) {
      setSelectedWorkId(latestWorkId)
    }
  }, [orderedWorkSummaries[0]?.work.id, orderedWorkSummaries[0]?.result?.id])

  const effectiveSelectedWorkId =
    selectedWorkId && orderedWorkSummaries.some((entry) => entry.work.id === selectedWorkId)
      ? selectedWorkId
      : orderedWorkSummaries[0]?.work.id ?? null
  const selected = studio.selectWork(effectiveSelectedWorkId)

  const handleReorderWorks = (nextWorkIds: string[]) => {
    setOrderedWorkIds(nextWorkIds)
  }

  return (
    <>
      <div
        className={`h-screen overflow-hidden bg-bg-primary text-text-primary ${
          isExiting ? 'animate-studio-exit' : 'animate-studio-entrance'
        }`}
      >
        <div className="relative h-screen overflow-hidden">
          <div className="flex h-full min-h-0 flex-col xl:flex-row">
            <div className="min-h-0 bg-white/72 shadow-[12px_0_36px_rgba(15,23,42,0.06)] backdrop-blur-xl xl:w-[36%] xl:min-w-[360px] xl:max-w-[500px]">
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

            <div className="min-h-0 flex-1">
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
