import { ManimCinemaWorkspace } from './cinema/ui/ManimCinemaWorkspace'
import type { StudioKind } from './protocol/studio-agent-types'

interface StudioShellProps {
  onExit: () => void
  isExiting?: boolean
  studioKind?: StudioKind
  concept?: string
}

/**
 * Studio entry.
 *
 * Both kinds now render the same Cinema workspace; `studioKind` only drives the Session/Scene/Sidebar
 * storage keys. The legacy composition (preview + command panel + run status) is gone.
 */
export function StudioShell({ onExit, isExiting, studioKind = 'manim', concept }: StudioShellProps) {
  return (
    <ManimCinemaWorkspace
      onExit={onExit}
      isExiting={isExiting}
      studioKind={studioKind}
      concept={concept}
    />
  )
}
