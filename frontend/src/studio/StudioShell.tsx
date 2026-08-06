import { useState } from 'react'
import { StudioCommandPanel } from './components/StudioCommandPanel'
import { StudioPreview } from './preview/StudioPreview'
import { RunStatus } from './status/RunStatus'
import { StudioSessionHistoryModal } from './commands/ui/StudioSessionHistoryModal'
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
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null)
  const effectiveSelectedRenderId =
    selectedRenderId && studio.renders.some((render) => render.id === selectedRenderId)
      ? selectedRenderId
      : studio.renders[0]?.id ?? null
  const selectedRender = studio.selectRender(effectiveSelectedRenderId)

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
          <StudioPreview
            session={studio.session}
            renders={studio.renders}
            selectedRenderId={effectiveSelectedRenderId}
            render={selectedRender}
            latestRun={studio.latestRun}
            onSelectRender={setSelectedRenderId}
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

          <RunStatus
            latestRun={studio.latestRun}
            render={selectedRender}
            latestAssistantText={studio.latestAssistantText}
            snapshotStatus={studio.state.connection.snapshotStatus}
            eventStatus={studio.state.connection.eventStatus}
            errorMessage={studio.state.error ?? studio.state.connection.eventError}
            onRefresh={studio.refresh}
            onCancel={() => studio.cancelCurrentRun('Cancelled from Studio status')}
          />
        </div>
      </div>

      <StudioSessionHistoryModal {...studio.historyModal} />
    </>
  )
}
