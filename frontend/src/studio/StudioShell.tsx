import { useState } from 'react'
import { StudioPermissionModeModal } from './controls/StudioPermissionModeModal'
import { StudioAssetsPanel } from './components/StudioAssetsPanel'
import { StudioCommandPanel } from './components/StudioCommandPanel'
import { StudioPipelinePanel } from './components/StudioPipelinePanel'
import { useStudioReview } from './hooks/use-studio-review'
import { useStudioSession } from './hooks/use-studio-session'
import type { StudioKind } from './protocol/studio-agent-types'

interface StudioShellProps {
  onExit: () => void
  isExiting?: boolean
  studioKind?: StudioKind
}

export function StudioShell({ onExit, isExiting, studioKind = 'manim' }: StudioShellProps) {
  const studio = useStudioSession({
    studioKind,
    title: studioKind === 'plot' ? 'Plot Studio' : 'Manim Studio'
  })
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const effectiveSelectedWorkId =
    selectedWorkId && studio.works.some((work) => work.id === selectedWorkId)
      ? selectedWorkId
      : studio.works[0]?.id ?? null
  const selected = studio.selectWork(effectiveSelectedWorkId)
  const review = useStudioReview(selected.result)

  return (
    <>
      <div
        className={`h-screen overflow-hidden bg-bg-primary text-text-primary studio-shell-root ${
          isExiting ? 'animate-studio-exit' : 'animate-studio-entrance'
        }`}
      >
        <div className="fixed inset-0 pointer-events-none opacity-40">
          <div className="absolute left-[-5%] top-[-10%] h-[40%] w-[40%] rounded-full bg-accent-rgb/10 blur-[120px]" />
          <div className="absolute bottom-[-5%] right-[-5%] h-[35%] w-[35%] rounded-full bg-accent-rgb/5 blur-[100px]" />
        </div>

        <div className="relative flex h-screen min-h-0 overflow-hidden backdrop-blur-[2px]">
          <StudioAssetsPanel
            session={studio.session}
            works={studio.workSummaries}
            selectedWorkId={effectiveSelectedWorkId}
            work={selected.work}
            result={selected.result}
            latestRun={studio.latestRun}
            onSelectWork={setSelectedWorkId}
          />

          <StudioCommandPanel
            session={studio.session}
            messages={studio.messages}
            latestAssistantText={studio.latestAssistantText}
            isBusy={studio.isBusy}
            disabled={studio.isBusy || studio.state.connection.snapshotStatus !== 'ready'}
            onRun={studio.runCommand}
            onExit={onExit}
          />

          <StudioPipelinePanel
            latestRun={studio.latestRun}
            work={selected.work}
            result={selected.result}
            tasks={selected.tasks}
            review={review}
            requests={studio.pendingPermissions}
            replyingPermissionIds={studio.replyingPermissionIds}
            latestAssistantText={studio.latestAssistantText}
            latestQuestion={studio.latestQuestion}
            snapshotStatus={studio.state.connection.snapshotStatus}
            eventStatus={studio.state.connection.eventStatus}
            errorMessage={studio.state.error ?? studio.state.connection.eventError}
            onReply={studio.replyPermission}
            onRefresh={studio.refresh}
          />
        </div>
      </div>

      <StudioPermissionModeModal {...studio.permissionModeModal} />
    </>
  )
}
