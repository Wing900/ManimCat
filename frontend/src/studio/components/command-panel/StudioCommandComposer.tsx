import { StudioComposerAttachmentList } from '../StudioComposerAttachmentList'
import { StudioImageInputCommandUI } from '../../commands/ui/image-input/StudioImageInputCommandUI'
import type { useStudioCommandComposerController } from './use-studio-command-composer-controller'

interface StudioCommandComposerProps {
  isFrameless: boolean
  isTLayout: boolean
  isMinimal: boolean
  isBusy: boolean
  disabled: boolean
  effectivePlaceholder: string
  enterToSendLabel: string
  onEscapePress?: () => void
  composer: ReturnType<typeof useStudioCommandComposerController>
}

export function StudioCommandComposer({
  isFrameless,
  isTLayout,
  isMinimal,
  isBusy,
  disabled,
  effectivePlaceholder,
  enterToSendLabel,
  onEscapePress,
  composer,
}: StudioCommandComposerProps) {
  return (
    <>
      <footer className={`shrink-0 ${isTLayout ? 'border-t border-[#f2f2f2] px-5 py-4' : isMinimal ? 'mt-auto pl-4 pr-3 pt-4' : 'px-8 py-6'}`}>
        <StudioComposerAttachmentList
          attachments={composer.attachments}
          disabled={isBusy}
          onRemove={composer.handleRemoveAttachment}
          variant={isMinimal ? 'minimal' : 'default'}
        />
        {composer.attachmentError ? (
          <p className="mb-3 mt-3 text-xs text-rose-500/80">{composer.attachmentError}</p>
        ) : null}
        <div className={`${isMinimal ? 'flex items-baseline gap-4' : 'group flex items-center gap-3'}`}>
          <span
            className={`${isTLayout ? 'font-mono text-sm text-[#999]' : isMinimal ? 'block w-4 shrink-0 text-center text-[11px] font-semibold leading-loose text-text-secondary/90' : 'font-mono text-sm text-text-secondary/40'} tracking-widest`}
          >
            {'>'}
          </span>
          <div className={`${isMinimal ? 'relative flex-1' : 'flex-1'}`}>
            <input
              ref={composer.inputRef}
              type="text"
              value={composer.input}
              onChange={(e) => composer.handleInputChange(e.target.value)}
              onPaste={(e) => { void composer.handlePaste(e) }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && onEscapePress) {
                  e.preventDefault()
                  e.stopPropagation()
                  onEscapePress()
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void composer.handleSubmit()
                }
              }}
              placeholder={isMinimal ? '' : effectivePlaceholder}
              disabled={false}
              aria-disabled={disabled}
              className={`w-full bg-transparent outline-none ${isTLayout ? 'text-[14px] text-[#333] placeholder:text-[#ccc]' : isMinimal ? 'text-[13px] leading-loose text-text-primary placeholder:text-text-secondary/65' : 'text-[14px] font-medium leading-relaxed text-text-primary placeholder:text-text-secondary/25'}`}
            />
            {isMinimal && (
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center">
                {composer.input.length === 0 && (
                  <span className="text-[13px] leading-loose text-text-secondary/72">
                    {effectivePlaceholder}（{enterToSendLabel}）
                  </span>
                )}
              </div>
            )}
          </div>
          {!isFrameless && (
            <div className="flex items-center gap-2 opacity-30">
              <div className="font-mono text-[9px] uppercase tracking-widest text-text-secondary">{enterToSendLabel}</div>
            </div>
          )}
          {isTLayout && (
            <span className="text-[11px] text-[#ccc] shrink-0">{enterToSendLabel}</span>
          )}
        </div>
      </footer>

      <StudioImageInputCommandUI
        isImageModeOpen={composer.imageInputCommand.isImageModeOpen}
        isCanvasOpen={composer.imageInputCommand.isCanvasOpen}
        onCloseImageMode={composer.imageInputCommand.closeImageInputMode}
        onCloseCanvas={composer.imageInputCommand.closeCanvas}
        onImportFiles={composer.imageInputCommand.handleImportFiles}
        onStartImport={composer.imageInputCommand.startImport}
        onStartDraw={composer.imageInputCommand.startDraw}
        onCanvasComplete={composer.imageInputCommand.handleCanvasComplete}
      />
    </>
  )
}
