import { useEffect, useState } from 'react'

export function useModalTransition(isOpen: boolean, duration: number = 400) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setIsExiting(false)
      return undefined
    }

    if (!shouldRender) {
      return undefined
    }

    setIsExiting(true)
    const timeoutId = window.setTimeout(() => {
      setShouldRender(false)
      setIsExiting(false)
    }, duration)

    return () => window.clearTimeout(timeoutId)
  }, [duration, isOpen, shouldRender])

  return { shouldRender, isExiting }
}
