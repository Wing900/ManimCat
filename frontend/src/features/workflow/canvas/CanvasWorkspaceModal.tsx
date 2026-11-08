import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ReferenceImage } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n';
import { CanvasPreviewStrip } from './CanvasPreviewStrip';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasHistoryControls } from './CanvasHistoryControls';
import { CanvasShapePanel } from './CanvasShapePanel';
import { CanvasSurface } from './CanvasSurface';
import { CanvasTextEditor } from './CanvasTextEditor';
import { CanvasFunctionEditor } from './CanvasFunctionEditor';
import { CanvasWorkspaceDialogs } from './CanvasWorkspaceDialogs';
import { useCanvasDocument } from './useCanvasDocument';
import { useCanvasExport } from './useCanvasExport';
import { DEFAULT_COLOR, DEFAULT_WIDTH, CANVAS_EXPORT_HEIGHT, CANVAS_EXPORT_WIDTH, CANVAS_PAPER_COLOR } from './constants';
import type { CanvasObject, ShapeKind, ToolMode } from './types';
import type { EditableObject, TextObject } from './objects/types';

interface CanvasWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (images: ReferenceImage[]) => void;
}

// A mounted workspace owns a fresh document and all its transient editors.
export function CanvasWorkspaceModal({ isOpen, ...props }: CanvasWorkspaceModalProps) {
  return isOpen ? <CanvasWorkspace {...props} /> : null;
}

function CanvasWorkspace({ onClose, onComplete }: Omit<CanvasWorkspaceModalProps, 'isOpen'>) {
  const { t } = useI18n();
  const doc = useCanvasDocument();
  const exporter = useCanvasExport();
  const [tool, setTool] = useState<ToolMode>('pen');
  const [shape, setShape] = useState<ShapeKind>('rectangle');
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [panel, setPanel] = useState<'shapes' | 'style' | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_WIDTH);
  const [editing, setEditing] = useState<EditableObject | null>(null);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const selected = doc.activePage.objects.find((o) => o.id === doc.selectedId);

  const requestClose = () => {
    if (exitTimerRef.current !== null) return;
    setIsExiting(true);
    exitTimerRef.current = window.setTimeout(onClose, 400);
  };
  useEffect(() => () => { if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current); }, []);

  const changeStyle = (style: { color?: string; width?: number }) => {
    if (style.color) setColor(style.color);
    if (style.width !== undefined) setStrokeWidth(style.width);
    if (tool === 'select' && selected) doc.saveObject({ ...selected, ...style });
  };
  const saveEdit = (object: CanvasObject) => { doc.saveObject(object); setEditing(null); setTool('select'); };
  const openEditor = (object: EditableObject) => {
    if (object.kind === 'text') doc.beginTransaction();
    setEditing(object);
  };
  const finishText = () => { doc.commitTransaction(); setEditing(null); };
  const removeText = (id: string) => doc.updateObjects((objects) => objects.some((o) => o.id === id) ? objects.filter((o) => o.id !== id) : objects);
  const updateText = (object: TextObject) => {
    setEditing(object);
    if (object.text.trim()) doc.saveObject(object);
    else removeText(object.id);
  };
  const cancelText = () => { doc.cancelTransaction(); setEditing(null); };
  const undo = () => { setEditing(null); doc.undo(); workspaceRef.current?.focus({ preventScroll: true }); };
  const redo = () => { setEditing(null); doc.redo(); workspaceRef.current?.focus({ preventScroll: true }); };
  const gutter = panel ? '[--gutter:10.5rem] xl:[--gutter:27.5rem]' : isToolbarCollapsed ? '[--gutter:8.75rem]' : '[--gutter:10.5rem]';
  const blocked = editing?.kind === 'function' || isDiscardConfirmOpen || exporter.isPreviewOpen || isExiting;

  return (
    <div ref={workspaceRef} tabIndex={-1} className={`fixed inset-0 z-[140] overflow-hidden bg-bg-primary outline-none ${isExiting ? 'animate-fade-out-soft' : 'animate-classic-entrance'}`}
      onKeyDown={(event) => {
        const target = event.target;
        if (blocked || event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)
          || (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select')))) return;
        const key = event.key.toLowerCase();
        if (key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
        else if (key === 'y' && !event.shiftKey) { event.preventDefault(); redo(); }
      }}>
      <div className="absolute inset-0 bg-bg-primary/95" />
      <div className="absolute inset-0 canvas-transition-grid opacity-40" />
      <div className="relative flex h-full w-full" inert={blocked}>
        <div className="pointer-events-none absolute left-8 top-1/2 z-10 -translate-y-1/2">
          <div className="relative pointer-events-auto">
            <CanvasToolbar tool={tool} isToolbarCollapsed={isToolbarCollapsed} isBrushSettingsOpen={panel === 'style'}
              color={tool === 'select' && selected ? selected.color : color}
              strokeWidth={tool === 'select' && selected ? selected.width : strokeWidth}
              onToggleCollapse={() => setIsToolbarCollapsed((prev) => !prev)}
              onSelectTool={(next) => { setTool(next); setPanel(next === 'shape' ? panel === 'shapes' ? null : 'shapes' : null); }}
              onToggleBrushSettings={() => setPanel((prev) => prev === 'style' ? null : 'style')}
              onDeletePage={doc.deletePage} onAddPage={doc.addPage}
              onChangeColor={(value) => changeStyle({ color: value })} onChangeStrokeWidth={(value) => changeStyle({ width: value })} t={t} />
            {panel === 'shapes' && <CanvasShapePanel shape={shape} onSelect={(next) => { setShape(next); setTool('shape'); }} onClose={() => setPanel(null)} />}
          </div>
        </div>
        <div className="pointer-events-none absolute left-8 top-8 z-10">
          <button type="button" onClick={() => doc.isDirty ? setIsDiscardConfirmOpen(true) : requestClose()}
            className="pointer-events-auto inline-flex items-center gap-2.5 rounded-2xl border border-border/5 bg-bg-secondary/80 px-5 py-3 text-sm font-medium text-text-secondary shadow-lg backdrop-blur-xl transition-all hover:bg-bg-secondary hover:text-text-primary">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
            {t('canvas.back')}
          </button>
        </div>
        <div className="pointer-events-none absolute right-8 top-8 z-10">
          <button type="button" onClick={() => exporter.prepare(doc.pages)}
            className="pointer-events-auto inline-flex items-center gap-2.5 rounded-2xl bg-accent px-6 py-3 text-sm font-medium text-white shadow-lg transition-all hover:bg-accent-hover active:scale-95">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            {t('canvas.confirm')}
          </button>
        </div>
        <CanvasHistoryControls canUndo={doc.canUndo} canRedo={doc.canRedo} onUndo={undo} onRedo={redo} />
        <div className={`relative h-full w-full pb-32 pt-24 ${gutter}`}>
          <div className="absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-[32px] border border-border/5 shadow-[0_48px_120px_-32px_rgba(0,0,0,0.12)] transition-[left,width] duration-500 ease-move"
            style={{
              backgroundColor: CANVAS_PAPER_COLOR,
              ['--paper-w' as string]: `min(calc(100% - var(--gutter) - 2rem), calc((100dvh - 14rem) * ${CANVAS_EXPORT_WIDTH / CANVAS_EXPORT_HEIGHT}), 1400px)`,
              width: 'var(--paper-w)', left: 'max(var(--gutter), calc((100% - var(--paper-w)) / 2))',
              aspectRatio: `${CANVAS_EXPORT_WIDTH} / ${CANVAS_EXPORT_HEIGHT}`,
            } as CSSProperties}>
            <CanvasSurface key={`${doc.activePageId}:${tool}:${shape}:${doc.historyRevision}`} page={doc.activePage} tool={tool} shape={shape}
              color={color} width={strokeWidth} selectedId={doc.selectedId} selectObject={doc.selectObject}
              saveObject={doc.saveObject} updateObjects={doc.updateObjects} deleteSelected={doc.deleteSelected} onEdit={openEditor}
              beginTransaction={doc.beginTransaction} commitTransaction={doc.commitTransaction} cancelTransaction={doc.cancelTransaction} />
            {editing?.kind === 'text' && <CanvasTextEditor key={editing.id} object={editing} onChange={updateText} onDone={finishText} onCancel={cancelText} />}
          </div>
        </div>
        {tool === 'shape' && <p className="pointer-events-none absolute bottom-28 left-1/2 max-w-[65vw] -translate-x-1/2 rounded-xl bg-bg-secondary/90 px-4 py-2 text-xs text-text-secondary">
          {t(`canvas.shape.${shape}`)} · {t(shape === 'polygon' ? 'canvas.polygonHint' : shape === 'text' || shape === 'function' ? 'canvas.placeHint' : 'canvas.dragHint')}
        </p>}
        <CanvasPreviewStrip pages={doc.pages} activePageId={doc.activePageId} onSelectPage={doc.selectPage} onAddPage={doc.addPage} t={t} />
      </div>
      {exporter.error && !exporter.isPreviewOpen && <p role="alert" className="absolute right-8 top-24 rounded-xl bg-bg-secondary p-3 text-sm text-rose-500">{t('canvas.exportError')}</p>}
      <CanvasWorkspaceDialogs isDiscardConfirmOpen={isDiscardConfirmOpen} setIsDiscardConfirmOpen={setIsDiscardConfirmOpen}
        isPreviewConfirmOpen={exporter.isPreviewOpen} previewImages={exporter.previewImages} isExporting={exporter.isExporting}
        exportError={exporter.error} requestClose={requestClose} onClosePreview={exporter.close}
        onConfirmPreview={() => { void exporter.confirm(onComplete, requestClose); }} />
      {editing?.kind === 'function' && <CanvasFunctionEditor key={editing.id} object={editing} onSave={saveEdit} onClose={() => setEditing(null)} />}
    </div>
  );
}
