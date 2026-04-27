import { useEffect, useRef } from 'react'
import { summarizeImageSource } from './utils'

interface PendingZoomTiming {
  opId: string
  source: 'wheel' | 'button'
  startedAt: number
  wallTime: string
  fromZoom: number
  toZoom: number
}

interface UseZoomTimingLoggerOptions {
  shouldRender: boolean
  activeImage?: string
  activeIndex: number
  appearance: string
  zoom: number
  initialZoom: number
}

export function useZoomTimingLogger({
  shouldRender,
  activeImage,
  activeIndex,
  appearance,
  zoom,
  initialZoom,
}: UseZoomTimingLoggerOptions) {
  const openStartedAtRef = useRef<number | null>(null)
  const pendingZoomTimingRef = useRef<PendingZoomTiming | null>(null)

  // Reset zoom on image change
  useEffect(() => {
    if (!shouldRender) {
      return
    }
    // This effect just returns the pending timing ref for external use
  }, [activeImage, initialZoom, shouldRender])

  // Log open-start
  useEffect(() => {
    if (!shouldRender || !activeImage) {
      return
    }
    openStartedAtRef.current = performance.now()
    console.info('[image-lightbox] open-start', {
      activeIndex,
      imageSource: summarizeImageSource(activeImage),
      appearance,
      startedAt: openStartedAtRef.current,
    })
  }, [activeImage, activeIndex, appearance, shouldRender])

  // Log zoom-commit and zoom-visible
  useEffect(() => {
    const pendingZoomTiming = pendingZoomTimingRef.current
    if (!pendingZoomTiming || pendingZoomTiming.toZoom !== zoom) {
      return
    }

    let paintFrame: number | null = null
    const commitFrame = window.requestAnimationFrame(() => {
      const commitDurationMs = Math.round(performance.now() - pendingZoomTiming.startedAt)
      console.info('[image-lightbox] zoom-commit', {
        opId: pendingZoomTiming.opId,
        at: new Date().toISOString(),
        activeIndex,
        imageSource: activeImage ? summarizeImageSource(activeImage) : null,
        source: pendingZoomTiming.source,
        fromZoom: pendingZoomTiming.fromZoom,
        toZoom: pendingZoomTiming.toZoom,
        startTimeMs: Math.round(pendingZoomTiming.startedAt),
        commitTimeMs: Math.round(performance.now()),
        durationMs: commitDurationMs,
      })

      paintFrame = window.requestAnimationFrame(() => {
        const paintDurationMs = Math.round(performance.now() - pendingZoomTiming.startedAt)
        console.info('[image-lightbox] zoom-visible', {
          opId: pendingZoomTiming.opId,
          at: new Date().toISOString(),
          activeIndex,
          imageSource: activeImage ? summarizeImageSource(activeImage) : null,
          source: pendingZoomTiming.source,
          fromZoom: pendingZoomTiming.fromZoom,
          toZoom: pendingZoomTiming.toZoom,
          startTimeMs: Math.round(pendingZoomTiming.startedAt),
          visibleTimeMs: Math.round(performance.now()),
          durationMs: paintDurationMs,
        })

        if (pendingZoomTimingRef.current === pendingZoomTiming) {
          pendingZoomTimingRef.current = null
        }
      })
    })

    return () => {
      window.cancelAnimationFrame(commitFrame)
      if (paintFrame !== null) {
        window.cancelAnimationFrame(paintFrame)
      }
    }
  }, [activeImage, activeIndex, zoom])

  // Log image-loaded
  const handleTrackedImageLoad = (event: React.SyntheticEvent<HTMLImageElement>, handleImageLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void) => {
    handleImageLoad(event)
    const startedAt = openStartedAtRef.current
    const loadedAt = performance.now()
    console.info('[image-lightbox] image-loaded', {
      activeIndex,
      imageSource: summarizeImageSource(activeImage),
      durationMs: startedAt === null ? null : Math.round(loadedAt - startedAt),
      naturalWidth: event.currentTarget.naturalWidth,
      naturalHeight: event.currentTarget.naturalHeight,
    })
  }

  const setPendingZoomTiming = (timing: PendingZoomTiming) => {
    pendingZoomTimingRef.current = timing
    console.info('[image-lightbox] zoom-start', {
      opId: timing.opId,
      at: timing.wallTime,
      activeIndex,
      imageSource: activeImage ? summarizeImageSource(activeImage) : null,
      source: timing.source,
      fromZoom: timing.fromZoom,
      toZoom: timing.toZoom,
      startTimeMs: Math.round(timing.startedAt),
    })
  }

  return { handleTrackedImageLoad, setPendingZoomTiming }
}
