import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { eraseStrokeWithCircle } from '../../canvas/canvas-geometry'
import { ERASER_RADIUS } from '../../canvas/constants'
import { drawStroke } from '../../canvas/canvas-render'
import type { Point, StrokeObject } from '../../canvas/types'

type AnnotationTool = 'pen' | 'eraser' | 'pan'

interface LightboxAnnotatorProps {
  imageKey: string
  imageRef: RefObject<HTMLImageElement | null>
  editable: boolean
  disabled?: boolean
  tool: AnnotationTool
  color: string
  strokeWidth: number
  onCancelEdit: () => void
  onCommit: (file: File) => Promise<void> | void
}

export function LightboxAnnotator({
  imageKey,
  imageRef,
  editable,
  disabled = false,
  tool,
  color,
  strokeWidth,
  onCancelEdit,
  onCommit,
}: LightboxAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeStrokeIdRef = useRef<string | null>(null)
  const isErasingRef = useRef(false)

  const [strokes, setStrokes] = useState<StrokeObject[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setStrokes([])
    setIsSubmitting(false)
    activeStrokeIdRef.current = null
    isErasingRef.current = false
  }, [editable, imageKey])

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) {
      return
    }

    const width = Math.max(1, image.naturalWidth || image.width || 1)
    const height = Math.max(1, image.naturalHeight || image.height || 1)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    strokes.forEach((stroke) => drawStroke(context, stroke))
  }, [strokes])

  useEffect(() => {
    redrawCanvas()
  }, [redrawCanvas])

  const pointerToCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable || disabled || isSubmitting) {
      return
    }

    if (tool === 'pan') {
      return
    }

    const canvas = canvasRef.current
    const point = pointerToCanvasPoint(event)
    if (!canvas || !point) {
      return
    }

    canvas.setPointerCapture(event.pointerId)

    if (tool === 'eraser') {
      isErasingRef.current = true
      setStrokes((current) => current.flatMap((stroke) => eraseStrokeWithCircle(stroke, point, ERASER_RADIUS)))
      return
    }

    const strokeId = crypto.randomUUID()
    activeStrokeIdRef.current = strokeId
    setStrokes((current) => [
      ...current,
      {
        id: strokeId,
        color,
        width: strokeWidth,
        points: [point],
      },
    ])
  }, [color, disabled, editable, isSubmitting, pointerToCanvasPoint, strokeWidth, tool])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable || disabled || isSubmitting) {
      return
    }

    if (tool === 'pan') {
      return
    }

    const point = pointerToCanvasPoint(event)
    if (!point) {
      return
    }

    if (tool === 'eraser' && isErasingRef.current) {
      setStrokes((current) => current.flatMap((stroke) => eraseStrokeWithCircle(stroke, point, ERASER_RADIUS)))
      return
    }

    if (tool === 'pen' && activeStrokeIdRef.current) {
      setStrokes((current) => current.map((stroke) => (
        stroke.id === activeStrokeIdRef.current
          ? { ...stroke, points: [...stroke.points, point] }
          : stroke
      )))
    }
  }, [disabled, editable, isSubmitting, pointerToCanvasPoint, tool])

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }

    activeStrokeIdRef.current = null
    isErasingRef.current = false
  }, [])

  const handleCommit = useCallback(async () => {
    if (disabled || isSubmitting) {
      return
    }

    const image = imageRef.current
    const overlay = canvasRef.current
    if (!image || !overlay) {
      return
    }

    setIsSubmitting(true)
    try {
      const width = Math.max(1, image.naturalWidth || image.width || 1)
      const height = Math.max(1, image.naturalHeight || image.height || 1)
      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = width
      exportCanvas.height = height
      const context = exportCanvas.getContext('2d')
      if (!context) {
        throw new Error('Canvas 2D context is unavailable')
      }

      context.drawImage(image, 0, 0, width, height)
      context.drawImage(overlay, 0, 0, width, height)

      const blob = await new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob((value) => {
          if (value) {
            resolve(value)
            return
          }
          reject(new Error('Failed to export annotated image'))
        }, 'image/png')
      })

      await onCommit(new File([blob], 'annotated-preview.png', { type: 'image/png' }))
    } finally {
      setIsSubmitting(false)
    }
  }, [disabled, isSubmitting, onCommit])

  useEffect(() => {
    if (!editable) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
        return
      }

      if (event.key === 'Shift') {
        event.preventDefault()
        onCancelEdit()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void handleCommit()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [editable, handleCommit, onCancelEdit])

  return (
    <>
      {isSubmitting && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-[#fafaf8]/70">
          <span className="text-[12px] text-accent/58">...</span>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${
          disabled || tool === 'pan' ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </>
  )
}
