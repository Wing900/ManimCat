import { useLayoutEffect, type RefObject } from 'react'

/** Playback follows visible ownership; CSS/inert alone cannot stop a media decoder. */
export function useVideoActivity(ref: RefObject<HTMLVideoElement | null>, active: boolean, source: string | null) {
  useLayoutEffect(() => {
    const video = ref.current
    if (!video) return
    let resumeOnVisible = active && document.hidden
    const play = () => { void video.play().catch(() => {}) }
    if (active && !document.hidden && video.getClientRects().length > 0) play()
    else video.pause()
    const onVisibility = () => {
      if (document.hidden) {
        resumeOnVisible = active && !video.paused
        video.pause()
      } else if (resumeOnVisible && active) {
        resumeOnVisible = false
        play()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      video.pause()
    }
  }, [ref, active, source])
}
