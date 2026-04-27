import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { LightboxAnnotator } from './LightboxAnnotator'

interface LightboxStageProps {
  activeImage: string
  activeIndex: number
  alt: string
  imageRef: RefObject<HTMLImageElement | null>
  isAnnotating: boolean
  annotationTool: 'pen' | 'eraser' | 'pan'
  annotationColor: string
  annotationStrokeWidth: number
  isPanning: boolean
  isStudioAppearance: boolean
  isExiting: boolean
  imageStyle: CSSProperties
  stageStyle: CSSProperties
  onImageLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void
  onPanStart: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPanMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPanEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  onPreventContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  onCancelAnnotating: () => void
  onCommitAnnotatedImage?: (attachment: { file: File; filename: string }) => Promise<void> | void
  buildAnnotatedFilename: () => string
}

export function LightboxStage({
  activeImage,
  alt,
  imageRef,
  isAnnotating,
  annotationTool,
  annotationColor,
  annotationStrokeWidth,
  isPanning,
  isStudioAppearance,
  isExiting,
  imageStyle,
  stageStyle,
  onImageLoad,
  onPanStart,
  onPanMove,
  onPanEnd,
  onClick,
  onContextMenu,
  onPreventContextMenu,
  onCancelAnnotating,
  onCommitAnnotatedImage,
  buildAnnotatedFilename,
}: LightboxStageProps) {
  return (
    <div
      className={`relative shrink-0 select-none ${
        !isAnnotating || annotationTool === 'pan'
          ? (isPanning ? 'cursor-grabbing' : 'cursor-grab')
          : ''
      }`}
      style={stageStyle}
      onPointerDown={onPanStart}
      onPointerMove={onPanMove}
      onPointerUp={onPanEnd}
      onPointerCancel={onPanEnd}
      onClick={onClick}
      onContextMenu={isAnnotating ? onPreventContextMenu : onContextMenu}
    >
      <img
        ref={imageRef}
        src={activeImage}
        alt={alt}
        className={`block h-full w-full max-w-none select-none ${
          isStudioAppearance ? 'drop-shadow-[0_30px_80px_rgba(148,163,184,0.28)] dark:drop-shadow-[0_32px_86px_rgba(0,0,0,0.42)]' : ''
        } ${isExiting ? 'animate-fade-out-soft' : 'animate-fade-in-soft'}`}
        crossOrigin={isStudioAppearance ? 'anonymous' : undefined}
        draggable={false}
        style={imageStyle}
        onLoad={onImageLoad}
        onClick={(event) => event.stopPropagation()}
      />
      {isAnnotating && onCommitAnnotatedImage ? (
        <LightboxAnnotator
          imageKey={activeImage}
          imageRef={imageRef}
          editable={isAnnotating}
          tool={annotationTool}
          color={annotationColor}
          strokeWidth={annotationStrokeWidth}
          onCancelEdit={onCancelAnnotating}
          onCommit={async (file) => {
            const filename = buildAnnotatedFilename()
            await onCommitAnnotatedImage({
              file: new File([file], filename, { type: file.type || 'image/png' }),
              filename,
            })
            onCancelAnnotating()
          }}
        />
      ) : null}
    </div>
  )
}
