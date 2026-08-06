import { useState } from 'react'
import { useStudioSession } from '../../hooks/use-studio-session'

export function usePlotStudioShell() {
  const studio = useStudioSession({
    studioKind: 'plot',
    title: 'Plot Studio'
  })
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null)
  const [confirmExitOpen, setConfirmExitOpen] = useState(false)
  const [interruptArmedUntil, setInterruptArmedUntil] = useState<number | null>(null)

  const effectiveSelectedRenderId =
    selectedRenderId && studio.renders.some((render) => render.id === selectedRenderId)
      ? selectedRenderId
      : studio.renders[0]?.id ?? null

  const selectedRender = studio.selectRender(effectiveSelectedRenderId)
  const interruptHintActive = interruptArmedUntil !== null && interruptArmedUntil > Date.now()

  const handleEscapePress = () => {
    const activeRun = studio.latestRun
    const runIsInterruptible = activeRun && (activeRun.status === 'pending' || activeRun.status === 'running')
    if (!runIsInterruptible) {
      setInterruptArmedUntil(null)
      return
    }

    const now = Date.now()
    if (interruptArmedUntil && interruptArmedUntil > now) {
      setInterruptArmedUntil(null)
      void studio.cancelCurrentRun('Cancelled by double-escape in Plot Studio')
      return
    }

    setInterruptArmedUntil(now + 3000)
    window.setTimeout(() => {
      setInterruptArmedUntil((current) => (current && current <= Date.now() ? null : current))
    }, 3100)
  }

  return {
    studio,
    selectedRender,
    effectiveSelectedRenderId,
    confirmExitOpen,
    setConfirmExitOpen,
    interruptHintActive,
    setSelectedRenderId,
    handleEscapePress,
  }
}
