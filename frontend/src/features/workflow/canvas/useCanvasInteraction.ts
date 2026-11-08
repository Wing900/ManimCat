import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getCanvasPoint } from './canvas-coordinates';
import { ERASER_RADIUS } from './constants';
import { eraseObjects, findObjectAtPoint, moveObject } from './objects/object-geometry';
import { createShape } from './objects/shape';
import { hitSelectionHandle, isInsideSelection, selectionAnchor, selectionCursor as cursorForHandle } from './canvas-selection';
import { getTransform, rotateObject, scaleObject } from './objects/object-transform';
import type { EditableObject } from './objects/types';
import type { CanvasObject, CanvasPage, Point, ShapeKind, ToolMode } from './types';

interface Options {
  page: CanvasPage; tool: ToolMode; shape: ShapeKind; color: string; width: number; selectedId: string | null;
  selectObject: (id: string | null) => void;
  saveObject: (object: CanvasObject) => void;
  updateObjects: (update: (objects: CanvasObject[]) => CanvasObject[]) => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  onEdit: (object: EditableObject) => void;
}
type Gesture = {
  pointerId: number; start: Point; original?: CanvasObject;
  transform?: { mode: 'scale' | 'rotate'; anchor: Point; vector: Point };
};

export function useCanvasInteraction(options: Options) {
  const { page, tool, shape, color, width, selectedId, selectObject, saveObject, updateObjects, onEdit, beginTransaction, commitTransaction, cancelTransaction } = options;
  const [draft, setDraft] = useState<CanvasObject | null>(null);
  const draftRef = useRef<CanvasObject | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [selectionCursor, setSelectionCursor] = useState('default');
  const setCurrent = (value: CanvasObject | null) => { draftRef.current = value; setDraft(value); };
  const cancel = () => {
    if (gesture.current && tool === 'eraser') cancelTransaction();
    gesture.current = null;
    setCurrent(null);
    setSelectionCursor('default');
  };
  const finishPolygon = (closed = false) => {
    const object = draftRef.current;
    if (object?.kind === 'polygon' && object.points.length >= (closed ? 3 : 2)) saveObject({ ...object, closed });
    cancel();
  };
  const erase = (point: Point, canvas: HTMLCanvasElement, previous = point) => {
    const ctx = canvas.getContext('2d') ?? undefined;
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / (ERASER_RADIUS / 2)));
    updateObjects((objects) => {
      let result = objects;
      for (let i = 1; i <= steps; i++) result = eraseObjects(result, {
        x: previous.x + (point.x - previous.x) * i / steps,
        y: previous.y + (point.y - previous.y) * i / steps,
      }, ERASER_RADIUS, ctx);
      return result;
    });
    selectObject(null);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    const point = getCanvasPoint(event, canvas);
    if (tool === 'shape' && shape === 'polygon') {
      const polygon = draftRef.current;
      if (polygon?.kind === 'polygon') {
        const first = polygon.points[0];
        const tolerance = 12 * canvas.width / canvas.getBoundingClientRect().width;
        if (polygon.points.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= tolerance) finishPolygon(true);
        else setCurrent({ ...polygon, points: [...polygon.points, point] });
      } else setCurrent({ id: crypto.randomUUID(), kind: 'polygon', color, width, points: [point], closed: false });
      return;
    }
    if (tool === 'shape' && (shape === 'text' || shape === 'function')) {
      const common = { id: crypto.randomUUID(), color, width };
      onEdit(shape === 'text'
        ? { ...common, kind: 'text', position: { x: Math.max(8, Math.min(point.x, 1290)), y: Math.max(8, Math.min(point.y, 840)) }, text: '', fontSize: 32, boxWidth: 300 }
        : { ...common, kind: 'function', bounds: { x: Math.min(point.x, 960), y: Math.max(32, Math.min(point.y, 450)), width: 600, height: 400 }, expression: 'x^2', xMin: -5, xMax: 5, yMin: -5, yMax: 5 });
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, start: point };
    if (tool === 'pen') setCurrent({ id: crypto.randomUUID(), kind: 'stroke', color, width, points: [point] });
    else if (tool === 'eraser') { beginTransaction(); erase(point, canvas); }
    else if (tool === 'shape') setCurrent(createShape(shape, point, point, color, width));
    else {
      const selected = page.objects.find((o) => o.id === selectedId);
      const ctx = canvas.getContext('2d') ?? undefined;
      const viewScale = canvas.getBoundingClientRect().width / canvas.width;
      const handle = selected ? hitSelectionHandle(selected, point, viewScale, ctx) : null;
      if (selected && handle !== null) {
        const anchor = selectionAnchor(selected, handle, ctx);
        const center = selectionAnchor(selected, 'rotate', ctx);
        gesture.current = {
          pointerId: event.pointerId, start: point, original: selected,
          transform: { mode: handle === 'rotate' ? 'rotate' : 'scale', anchor, vector: { x: 2 * (center.x - anchor.x), y: 2 * (center.y - anchor.y) } },
        };
        setSelectionCursor(handle === 'rotate' ? 'grabbing' : cursorForHandle(selected, handle));
        setCurrent(selected);
        return;
      }
      const target = findObjectAtPoint(page.objects, point, ctx)
        ?? (selected && isInsideSelection(selected, point, ctx) ? selected : null);
      selectObject(target?.id ?? null);
      if (target) { gesture.current.original = target; setCurrent(target); }
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event, event.currentTarget);
    setCursor(point);
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) {
      if (tool === 'select') {
        const canvas = event.currentTarget;
        const ctx = canvas.getContext('2d') ?? undefined;
        const selected = page.objects.find((o) => o.id === selectedId);
        const handle = selected ? hitSelectionHandle(selected, point, canvas.getBoundingClientRect().width / canvas.width, ctx) : null;
        setSelectionCursor(selected && handle !== null ? cursorForHandle(selected, handle)
          : selected && isInsideSelection(selected, point, ctx) ? 'move' : 'default');
      }
      return;
    }
    const current = draftRef.current;
    if (tool === 'eraser') { erase(point, event.currentTarget, g.start); g.start = point; return; }
    if (current?.kind === 'stroke' && tool === 'pen') {
      const last = current.points[current.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 0.8) setCurrent({ ...current, points: [...current.points, point] });
    } else if (tool === 'shape') {
      const next = createShape(shape, g.start, point, color, width);
      setCurrent({ ...next, id: current?.id ?? next.id });
    } else if (g.original) {
      if (g.transform?.mode === 'rotate') {
        const anchor = g.transform.anchor;
        let angle = Math.atan2(point.y - anchor.y, point.x - anchor.x) - Math.atan2(g.start.y - anchor.y, g.start.x - anchor.x);
        if (event.shiftKey) {
          const m = getTransform(g.original);
          const originalAngle = Math.atan2(m.b, m.a);
          angle = Math.round((originalAngle + angle) / (Math.PI / 12)) * (Math.PI / 12) - originalAngle;
        }
        setCurrent(rotateObject(g.original, anchor, angle));
      } else if (g.transform?.mode === 'scale') {
        const anchor = g.transform.anchor;
        const { x: dx, y: dy } = g.transform.vector;
        const denominator = dx * dx + dy * dy;
        const factor = denominator > 0 ? 1 + ((point.x - g.start.x) * dx + (point.y - g.start.y) * dy) / denominator : 1;
        setCurrent(scaleObject(g.original, anchor, factor));
      } else setCurrent(moveObject(g.original, point.x - g.start.x, point.y - g.start.y));
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    // Pointerup may carry a final position that had no preceding pointermove.
    onPointerMove(event);
    const current = draftRef.current;
    if (current) {
      const end = getCanvasPoint(event, event.currentTarget);
      const distance = Math.hypot(end.x - g.start.x, end.y - g.start.y);
      const hasArea = !('bounds' in current) || (current.bounds.width >= 3 && current.bounds.height >= 3);
      if (tool === 'pen' || (tool === 'select' && distance > 0) || (tool === 'shape' && distance >= 3 && hasArea)) saveObject(current);
    }
    if (tool === 'eraser') commitTransaction();
    gesture.current = null;
    setCurrent(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return;
    const target = findObjectAtPoint(page.objects, getCanvasPoint(event, event.currentTarget), event.currentTarget.getContext('2d') ?? undefined);
    if (target?.kind === 'text' || target?.kind === 'function') { cancel(); onEdit(target); }
  };
  return { draft, cursor, selectionCursor, cancel, finishPolygon, handlers: {
    onPointerDown, onPointerMove, onPointerUp, onDoubleClick,
    onPointerCancel: cancel, onLostPointerCapture: cancel,
    onPointerLeave: () => setCursor(null),
  } };
}
