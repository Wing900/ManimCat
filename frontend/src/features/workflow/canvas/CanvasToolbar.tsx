import { COLOR_PRESETS } from './constants';
import type { I18nContextValue } from '../../../shared/i18n/context';
import type { ToolMode } from './types';

interface CanvasToolbarProps {
  tool: ToolMode;
  isToolbarCollapsed: boolean;
  isBrushSettingsOpen: boolean;
  color: string;
  strokeWidth: number;
  onToggleCollapse: () => void;
  onSelectTool: (tool: ToolMode) => void;
  onToggleBrushSettings: () => void;
  onDeletePage: () => void;
  onAddPage: () => void;
  onChangeColor: (value: string) => void;
  onChangeStrokeWidth: (value: number) => void;
  t: I18nContextValue['t'];
}

export function CanvasToolbar(props: CanvasToolbarProps) {
  const {
    tool,
    isToolbarCollapsed,
    isBrushSettingsOpen,
    color,
    strokeWidth,
    onToggleCollapse,
    onSelectTool,
    onToggleBrushSettings,
    onDeletePage,
    onAddPage,
    onChangeColor,
    onChangeStrokeWidth,
    t,
  } = props;

  const renderToolButton = (mode: ToolMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onSelectTool(mode)}
      className={`flex h-12 ${isToolbarCollapsed ? 'w-12' : 'w-16'} items-center justify-center rounded-2xl transition-all duration-300 ${
        tool === mode
          ? 'bg-accent text-white shadow-lg shadow-accent/25 scale-[1.05]'
          : 'bg-bg-primary/40 text-text-secondary hover:text-text-primary hover:bg-bg-primary/80'
      }`}
      title={label}
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-1.5">
        {icon}
        {!isToolbarCollapsed && <span className="text-[11px] font-medium leading-none">{label}</span>}
      </div>
    </button>
  );

  return (
    <div className="relative pointer-events-auto">
      <div className={`flex flex-col gap-3 rounded-[2.5rem] border border-border/5 bg-bg-secondary/40 p-2.5 shadow-2xl backdrop-blur-xl transition-all ${isToolbarCollapsed ? 'w-[68px]' : 'w-[96px]'}`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-10 w-full items-center justify-center rounded-2xl bg-bg-primary/30 text-text-secondary/50 transition-all hover:text-text-primary hover:bg-bg-primary/60"
          title={isToolbarCollapsed ? t('canvas.toolbarExpand') : t('canvas.toolbarCollapse')}
        >
          <svg className={`h-4 w-4 transition-transform duration-500 ${isToolbarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex flex-col gap-2">
          {renderToolButton('select', t('canvas.tool.select'), (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
            </svg>
          ))}
          {renderToolButton('pen', t('canvas.tool.pen'), (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m15 5 4 4" />
            </svg>
          ))}
          {renderToolButton('shape', t('canvas.tool.shapes'), (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5.5" r="3.5" />
              <rect x="2" y="14" width="7" height="7" rx="0.5" />
              <path d="m18.5 14 3.5 7h-7Z" />
            </svg>
          ))}
          {renderToolButton('eraser', t('canvas.tool.eraser'), (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 21H7" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m5 11 9 9" />
            </svg>
          ))}

          <button
            type="button"
            onClick={onToggleBrushSettings}
            disabled={tool === 'eraser'}
            className={`flex h-12 ${isToolbarCollapsed ? 'w-12' : 'w-16'} items-center justify-center rounded-2xl transition-all duration-300 ${
              isBrushSettingsOpen
                ? 'bg-accent text-white shadow-lg shadow-accent/25 scale-[1.05]'
                : 'bg-bg-primary/40 text-text-secondary hover:text-text-primary hover:bg-bg-primary/80 disabled:opacity-40'
            }`}
            title={t('canvas.tool.brushSettings')}
          >
            <div className="flex flex-col items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 2v4M8 10v4M16 18v4" />
              </svg>
              {!isToolbarCollapsed && <span className="text-[11px] font-medium leading-none">{t('canvas.tool.brushSettings')}</span>}
            </div>
          </button>
        </div>

        <div className="mx-2 h-px bg-border/5" />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onDeletePage}
            className={`flex h-12 ${isToolbarCollapsed ? 'w-12' : 'w-16'} items-center justify-center rounded-2xl bg-bg-primary/20 text-rose-500/60 transition-all hover:bg-rose-500/10 hover:text-rose-500`}
            title={t('canvas.tool.deletePage')}
          >
            <div className="flex flex-col items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 11v6M14 11v6" />
              </svg>
              {!isToolbarCollapsed && <span className="text-[11px] font-medium leading-none">{t('canvas.tool.deletePage')}</span>}
            </div>
          </button>

          <button
            type="button"
            onClick={onAddPage}
            className={`flex h-12 ${isToolbarCollapsed ? 'w-12' : 'w-16'} items-center justify-center rounded-2xl bg-bg-primary/30 text-text-secondary/50 transition-all hover:bg-bg-primary/60 hover:text-text-primary`}
            title={t('canvas.tool.addPage')}
          >
            <div className="flex flex-col items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 5v14m-7-7h14" />
              </svg>
              {!isToolbarCollapsed && <span className="text-[11px] font-medium leading-none">{t('canvas.tool.addPage')}</span>}
            </div>
          </button>
        </div>
      </div>

      {tool !== 'eraser' && isBrushSettingsOpen && (
        <div className="absolute left-[calc(100%+16px)] top-0 w-44 rounded-[28px] border border-border/5 bg-bg-secondary/80 p-5 shadow-2xl backdrop-blur-xl animate-fade-in-soft">
          <div className="mb-3.5 text-[11px] font-medium text-text-secondary/50">{t('canvas.color')}</div>
          <div className="grid grid-cols-4 gap-2.5">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChangeColor(preset)}
                className={`h-6 w-6 rounded-full transition-all duration-300 ${color === preset ? 'ring-2 ring-offset-2 ring-accent scale-90' : 'hover:scale-110'}`}
                style={{ backgroundColor: preset }}
                aria-label={preset}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
             <input
              type="color"
              value={color}
              onChange={(event) => onChangeColor(event.target.value)}
              className="h-8 w-12 cursor-pointer rounded-lg border-none bg-transparent"
            />
            <span className="font-mono text-[10px] text-text-secondary/40 uppercase tracking-tighter">{color}</span>
          </div>

          <div className="mt-7 mb-3.5 text-[11px] font-medium text-text-secondary/50">{t('canvas.stroke')}</div>
          <input
            type="range"
            min={2}
            max={28}
            value={strokeWidth}
            onChange={(event) => onChangeStrokeWidth(Number(event.target.value))}
            className="w-full accent-accent"
          />
          <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-text-secondary/40">
            <span>{t('canvas.strokeThin')}</span>
            <span>{strokeWidth}px</span>
            <span>{t('canvas.strokeThick')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
