import type { RefObject } from 'react'
import { StudioCommandPanel, type StudioCommandPanelHandle } from '../components/StudioCommandPanel'
import { StudioPreview } from '../preview/StudioPreview'
import { RunStatus } from '../status/RunStatus'
import type { usePlotStudioShell } from './hooks/use-plot-studio-shell'

interface PlotStudioWorkspaceProps {
  commandPanelRef: RefObject<StudioCommandPanelHandle | null>
  shell: ReturnType<typeof usePlotStudioShell>
  onExit: () => void
  interruptPlaceholder: string | undefined
}

export function PlotStudioWorkspace({
  commandPanelRef,
  shell,
  onExit,
  interruptPlaceholder,
}: PlotStudioWorkspaceProps) {
  return (
    <main className="flex min-h-0 flex-1 overflow-hidden">
      <StudioPreview
        session={shell.studio.session}
        renders={shell.studio.renders}
        selectedRenderId={shell.effectiveSelectedRenderId}
        render={shell.selectedRender}
        latestRun={shell.studio.latestRun}
        onSelectRender={shell.setSelectedRenderId}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col px-6 pb-6 md:px-10">
        <StudioCommandPanel
          ref={commandPanelRef}
          session={shell.studio.session}
          messages={shell.studio.messages}
          latestAssistantText={shell.studio.latestAssistantText}
          isBusy={shell.studio.isBusy}
          disabled={shell.studio.isBusy || shell.studio.state.connection.snapshotStatus !== 'ready'}
          onRun={shell.studio.runCommand}
          onExit={onExit}
          onEscapePress={shell.handleEscapePress}
          inputPlaceholderOverride={interruptPlaceholder}
        />
      </div>

      <RunStatus
        latestRun={shell.studio.latestRun}
        render={shell.selectedRender}
        latestAssistantText={shell.studio.latestAssistantText}
        snapshotStatus={shell.studio.state.connection.snapshotStatus}
        eventStatus={shell.studio.state.connection.eventStatus}
        errorMessage={shell.studio.state.error ?? shell.studio.state.connection.eventError}
        onRefresh={shell.studio.refresh}
        onCancel={() => shell.studio.cancelCurrentRun('Cancelled from Plot Studio status')}
      />
    </main>
  )
}
