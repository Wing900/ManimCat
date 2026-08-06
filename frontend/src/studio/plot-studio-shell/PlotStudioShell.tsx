import { useRef } from 'react'
import { useI18n } from '../../i18n'
import { StudioSessionHistoryModal } from '../commands/ui/StudioSessionHistoryModal'
import type { StudioCommandPanelHandle } from '../components/StudioCommandPanel'
import { PlotStudioDragOverlay } from './components/PlotStudioDragOverlay'
import { PlotStudioExitConfirmModal } from './components/PlotStudioExitConfirmModal'
import { PlotStudioShellHeader } from './components/PlotStudioShellHeader'
import { PlotStudioWorkspace } from './PlotStudioWorkspace'
import { usePlotStudioDragOverlay } from './hooks/use-plot-studio-drag-overlay'
import { usePlotStudioShell } from './hooks/use-plot-studio-shell'
import type { PlotStudioShellProps } from './types'

export function PlotStudioShell({ onExit, isExiting }: PlotStudioShellProps) {
  const { t } = useI18n()
  const commandPanelRef = useRef<StudioCommandPanelHandle | null>(null)
  const shell = usePlotStudioShell()
  const dragOverlay = usePlotStudioDragOverlay({ commandPanelRef })

  return (
    <>
      <div
        {...dragOverlay.shellDragBindings}
        className={`studio-shell-root relative isolate flex min-h-screen flex-col overflow-y-auto bg-bg-primary px-6 pb-2 pt-7 text-text-primary antialiased sm:px-8 sm:pb-3 sm:pt-8 md:h-screen md:overflow-hidden md:px-10 md:pb-4 md:pt-10 lg:px-12 lg:pb-5 lg:pt-12 ${
          isExiting ? 'animate-studio-exit' : 'animate-studio-entrance'
        }`}
      >
        {dragOverlay.isDraggingImages && <PlotStudioDragOverlay />}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(66,66,66,0.045),_transparent_52%),radial-gradient(circle_at_bottom_right,_rgba(66,66,66,0.04),_transparent_36%)] dark:bg-[radial-gradient(circle_at_top,_rgba(138,138,138,0.08),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(138,138,138,0.05),_transparent_32%)]"
        />

        <PlotStudioShellHeader
          onExitClick={() => shell.setConfirmExitOpen(true)}
        />

        <PlotStudioWorkspace
          commandPanelRef={commandPanelRef}
          shell={shell}
          onExit={onExit}
          interruptPlaceholder={shell.interruptHintActive ? t('studio.interruptPlaceholder') : undefined}
        />
      </div>

      <StudioSessionHistoryModal {...shell.studio.historyModal} />
      <PlotStudioExitConfirmModal
        isOpen={shell.confirmExitOpen}
        onClose={() => shell.setConfirmExitOpen(false)}
        onConfirm={() => {
          shell.setConfirmExitOpen(false)
          onExit()
        }}
      />
    </>
  )
}
