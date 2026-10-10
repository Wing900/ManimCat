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
        {!isToolbarCollapsed && <span className="text-[8px] font-bold uppercase tracking-[0.2em]">{label}</span>}
      </div>
    </button>
  );

  return (
    <div className="relative pointer-events-auto">
      <div className={`flex flex-col gap-3 rounded-[32px] border border-border/5 bg-bg-secondary/40 p-2.5 shadow-2xl backdrop-blur-xl transition-all ${isToolbarCollapsed ? 'w-[68px]' : 'w-[96px]'}`}>
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 3l12 7-5 2 2 5-2 1-2-5-5 2V3z" />
            </svg>
          ))}
          {renderToolButton('pen', t('canvas.tool.pen'), (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          ))}
          {renderToolButton('eraser', t('canvas.tool.eraser'), (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 14a5 5 0 11-10 0 5 5 0 0110 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 14H9" />
            </svg>
          ))}

          <button
            type="button"
            onClick={onToggleBrushSettings}
            className={`flex h-12 ${isToolbarCollapsed ? 'w-12' : 'w-16'} items-center justify-center rounded-2xl transition-all duration-300 ${
              isBrushSettingsOpen
                ? 'bg-accent text-white shadow-lg shadow-accent/25 scale-[1.05]'
                : 'bg-bg-primary/40 text-text-secondary hover:text-text-primary hover:bg-bg-primary/80'
            }`}
            title={t('canvas.tool.brushSettings')}
          >
            <div className="flex flex-col items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 7h16M7 12h10M10 17h4" />
              </svg>
              {!isToolbarCollapsed && <span className="text-[8px] font-bold uppercase tracking-[0.2em]">{t('canvas.tool.brushSettings')}</span>}
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 7h12M9 7V5h6v2m-7 4v6m4-6v6m4-6v6M7 7l1 12h8l1-12" />
              </svg>
              {!isToolbarCollapsed && <span className="text-[8px] font-bold uppercase tracking-[0.2em]">{t('canvas.tool.deletePage')}</span>}
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
              {!isToolbarCollapsed && <span className="text-[8px] font-bold uppercase tracking-[0.2em]">{t('canvas.tool.addPage')}</span>}
            </div>
          </button>
        </div>
      </div>

      {tool === 'pen' && isBrushSettingsOpen && (
        <div className="absolute left-[calc(100%+16px)] top-0 w-48 rounded-[28px] border border-border/5 bg-bg-secondary/80 p-5 shadow-2xl backdrop-blur-xl animate-fade-in-soft">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary/40">{t('canvas.color')}</div>
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

          <div className="mt-8 mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary/40">{t('canvas.stroke')}</div>
          <input
            type="range"
            min={2}
            max={28}
            value={strokeWidth}
            onChange={(event) => onChangeStrokeWidth(Number(event.target.value))}
            className="w-full accent-accent"
          />
          <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-text-secondary/40">
            <span>Thin</span>
            <span>{strokeWidth}px</span>
            <span>Thick</span>
          </div>
        </div>
      )}
    </div>
  );
}
