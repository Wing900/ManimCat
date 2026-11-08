import { useEffect, useRef } from 'react';
import { useI18n } from '../../../shared/i18n';
import { CANVAS_EXPORT_HEIGHT, CANVAS_EXPORT_WIDTH, ERASER_RADIUS } from './constants';
import { drawObject, drawPage } from './canvas-render';
import { drawSelection } from './canvas-selection';
import { useCanvasInteraction } from './useCanvasInteraction';
import type { CanvasObject, CanvasPage, ShapeKind, ToolMode } from './types';
import type { EditableObject } from './objects/types';

interface Props {
  page: CanvasPage; tool: ToolMode; shape: ShapeKind; color: string; width: number; selectedId: string | null;
  selectObject: (id: string | null) => void;
  saveObject: (object: CanvasObject) => void;
  updateObjects: (update: (objects: CanvasObject[]) => CanvasObject[]) => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  deleteSelected: () => void;
  onEdit: (object: EditableObject) => void;
}

export function CanvasSurface(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useI18n();
  const interaction = useCanvasInteraction(props);
  const { draft, cursor } = interaction;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const existingDraft = draft && props.page.objects.some((o) => o.id === draft.id);
      const page = existingDraft ? { ...props.page, objects: props.page.objects.map((o) => o.id === draft.id ? draft : o) } : props.page;
      drawPage(ctx, page);
      if (draft) {
        if (!existingDraft) drawObject(ctx, draft);
        if (draft.kind === 'polygon' && props.tool === 'shape' && props.shape === 'polygon' && cursor) {
          const last = draft.points[draft.points.length - 1];
          ctx.save(); ctx.strokeStyle = draft.color; ctx.lineWidth = draft.width; ctx.setLineDash([8, 6]);
          ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(cursor.x, cursor.y); ctx.stroke(); ctx.restore();
        }
      }
      const selected = draft ?? props.page.objects.find((o) => o.id === props.selectedId);
      if (selected && props.tool === 'select') drawSelection(ctx, selected, (canvasRef.current?.getBoundingClientRect().width ?? CANVAS_EXPORT_WIDTH) / CANVAS_EXPORT_WIDTH);
      if (props.tool === 'eraser' && cursor) {
        ctx.save(); ctx.strokeStyle = 'rgba(20,20,20,0.4)'; ctx.fillStyle = 'rgba(120,120,120,0.16)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, ERASER_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [props.page, props.selectedId, props.tool, props.shape, draft, cursor]);
  return (
    <canvas ref={canvasRef} width={CANVAS_EXPORT_WIDTH} height={CANVAS_EXPORT_HEIGHT}
      tabIndex={0} aria-label={t('canvas.surfaceLabel')}
      className="relative z-[1] h-full w-full touch-none outline-none"
      style={{ cursor: props.tool === 'select' ? interaction.selectionCursor : 'crosshair' }}
      {...interaction.handlers}
      onPointerDown={(event) => { event.currentTarget.focus(); interaction.handlers.onPointerDown(event); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); interaction.cancel(); props.selectObject(null); }
        else if (event.key === 'Enter' && draft?.kind === 'polygon') { event.preventDefault(); interaction.finishPolygon(); }
        else if (props.tool === 'select' && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); interaction.cancel(); props.deleteSelected(); }
        else if (event.key === 'Enter' && props.tool === 'select') {
          const selected = props.page.objects.find((o) => o.id === props.selectedId);
          if (selected?.kind === 'text' || selected?.kind === 'function') props.onEdit(selected);
        }
      }}
    />
  );
}
