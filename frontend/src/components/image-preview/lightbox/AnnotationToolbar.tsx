import type { ReactNode } from 'react'
import { useI18n } from '../../../i18n'
import { COLOR_PRESETS } from '../../canvas/constants'

type AnnotationTool = 'pen' | 'eraser' | 'pan'

interface AnnotationToolbarProps {
  isAnnotating: boolean
  tool: AnnotationTool
  color: string
  strokeWidth: number
  isBrushSettingsOpen: boolean
  onToolChange: (tool: AnnotationTool) => void
  onColorChange: (color: string) => void
  onStrokeWidthChange: (width: number) => void
  onBrushSettingsToggle: () => void
}

export function AnnotationToolbar({
  isAnnotating,
  tool,
  color,
  strokeWidth,
  isBrushSettingsOpen,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onBrushSettingsToggle,
}: AnnotationToolbarProps) {
  const { t } = useI18n()

  return (
    <div className="pointer-events-none absolute bottom-5 left-6 z-30 flex max-w-[22rem] flex-col items-start gap-3 text-left">
      {isAnnotating ? (
        <>
          <div className="pointer-events-auto absolute bottom-[calc(100%+18px)] left-0 flex flex-col gap-3">
            <div className="flex flex-col gap-3 rounded-[28px] border border-border/5 bg-white/72 p-2.5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-bg-secondary/82">
              <ToolButton active={tool === 'pen'} label={t('studio.plot.annotationPen')} onClick={() => onToolChange('pen')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              </ToolButton>
              <ToolButton active={tool === 'eraser'} label={t('studio.plot.annotationEraser')} onClick={() => onToolChange('eraser')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 14a5 5 0 11-10 0 5 5 0 0110 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 14H9" />
                </svg>
              </ToolButton>
              <ToolButton active={tool === 'pan'} label={t('studio.plot.annotationPan')} onClick={() => onToolChange('pan')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M8 11V6.5a1.5 1.5 0 013 0V10" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M12 10V5.5a1.5 1.5 0 013 0V10" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M16 10V7.5a1.5 1.5 0 013 0v5.2c0 3.5-2.1 6.3-5.8 7.3l-1.8.5c-1.7.5-3.6.1-5-1.2L4 16.9" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M8 10.5V9a1.5 1.5 0 00-3 0v5" />
                </svg>
              </ToolButton>
              <ToolButton active={isBrushSettingsOpen} label={t('canvas.tool.brushSettings')} onClick={onBrushSettingsToggle}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 7h16M7 12h10M10 17h4" />
                </svg>
              </ToolButton>
            </div>
            {tool === 'pen' && isBrushSettingsOpen ? (
              <div className="w-48 rounded-[28px] border border-border/5 bg-white/82 p-5 shadow-2xl backdrop-blur-xl animate-fade-in-soft dark:border-white/10 dark:bg-bg-secondary/88">
                <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary/40 dark:text-text-secondary/70">{t('canvas.color')}</div>
                <div className="grid grid-cols-4 gap-2.5">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onColorChange(preset)}
                      className={`h-6 w-6 rounded-full transition-all duration-300 ${
                        color === preset ? 'ring-2 ring-offset-2 ring-accent scale-90' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: preset }}
                      aria-label={preset}
                    />
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => onColorChange(event.target.value)}
                    className="h-8 w-12 cursor-pointer rounded-lg border-none bg-transparent"
                  />
                  <span className="font-mono text-[10px] uppercase tracking-tighter text-text-secondary/40 dark:text-text-secondary/70">{color}</span>
                </div>
                <div className="mb-4 mt-8 text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary/40 dark:text-text-secondary/70">{t('canvas.stroke')}</div>
                <input
                  type="range"
                  min={2}
                  max={28}
                  value={strokeWidth}
                  onChange={(event) => onStrokeWidthChange(Number(event.target.value))}
                  className="w-full accent-accent"
                />
                <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-text-secondary/40 dark:text-text-secondary/70">
                  <span>{t('canvas.strokeThin')}</span>
                  <span>{strokeWidth}px</span>
                  <span>{t('canvas.strokeThick')}</span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="text-[11px] font-medium text-text-secondary/55 dark:text-text-secondary/72">
            {t('studio.plot.annotationHintEditing')}
          </div>
        </>
      ) : (
        <div className="text-[11px] font-medium text-text-secondary/55 dark:text-text-secondary/72">
          {t('studio.plot.annotationHintIdle')}
        </div>
      )}
    </div>
  )
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 ${
        active
          ? 'bg-accent text-white shadow-lg shadow-accent/20'
          : 'bg-bg-primary/40 text-text-secondary hover:bg-bg-primary/70 hover:text-text-primary dark:bg-white/10 dark:text-white/75 dark:hover:bg-white/15 dark:hover:text-white'
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
