import { getObjectBounds } from './objects/object-geometry';
import { applyObjectTransform, getTransform, toLocalPoint, toWorldPoint, transformScale } from './objects/object-transform';
import type { Bounds, CanvasObject, Point } from './objects/types';

export type SelectionHandle = 0 | 1 | 2 | 3 | 'rotate';

function corners(b: Bounds): Point[] {
  return [
    { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
  ];
}

function inkBounds(object: CanvasObject, ctx?: CanvasRenderingContext2D): Bounds {
  const b = getObjectBounds(object, ctx);
  const padding = object.kind === 'text' || object.kind === 'function' ? 0 : object.width * (object.kind === 'stroke' ? 0.95 : 0.5);
  return { x: b.x - padding, y: b.y - padding, width: b.width + padding * 2, height: b.height + padding * 2 };
}

function selectionFrame(object: CanvasObject, viewScale: number, ctx?: CanvasRenderingContext2D) {
  const bounds = inkBounds(object, ctx);
  const unit = 1 / (viewScale * transformScale(object));
  const padding = 6 * unit;
  const width = Math.max(24 * unit, bounds.width + padding * 2);
  const height = Math.max(24 * unit, bounds.height + padding * 2);
  const frame = { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height };
  return {
    bounds, frame, unit, corners: corners(frame),
    rotation: { x: frame.x + frame.width / 2, y: frame.y - 24 * unit },
  };
}

export function hitSelectionHandle(object: CanvasObject, point: Point, viewScale: number, ctx?: CanvasRenderingContext2D): SelectionHandle | null {
  const frame = selectionFrame(object, viewScale, ctx);
  const local = toLocalPoint(object, point);
  const near = (p: Point) => Math.hypot(local.x - p.x, local.y - p.y) <= 9 * frame.unit;
  if (near(frame.rotation)) return 'rotate';
  for (const index of [0, 1, 2, 3] as const) if (near(frame.corners[index])) return index;
  return null;
}

export function selectionAnchor(object: CanvasObject, handle: SelectionHandle, ctx?: CanvasRenderingContext2D): Point {
  const bounds = inkBounds(object, ctx);
  return toWorldPoint(object, handle === 'rotate'
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : corners(bounds)[(handle + 2) % 4]);
}

export function selectionCursor(object: CanvasObject, handle: SelectionHandle): string {
  if (handle === 'rotate') return 'grab';
  const m = getTransform(object);
  const angle = Math.atan2(m.b, m.a) + (handle === 0 || handle === 2 ? Math.PI / 4 : -Math.PI / 4);
  const index = (Math.round(angle / (Math.PI / 4)) % 4 + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][index];
}

export function isInsideSelection(object: CanvasObject, point: Point, ctx?: CanvasRenderingContext2D): boolean {
  const b = getObjectBounds(object, ctx), p = toLocalPoint(object, point);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

export function drawSelection(ctx: CanvasRenderingContext2D, object: CanvasObject, viewScale = 1) {
  const { frame, unit, corners, rotation } = selectionFrame(object, viewScale, ctx);
  ctx.save();
  applyObjectTransform(ctx, object);
  ctx.strokeStyle = 'rgba(78, 73, 66, 0.58)';
  ctx.fillStyle = '#fffefb';
  ctx.setLineDash([]);
  ctx.lineWidth = unit;
  ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
  ctx.beginPath();
  ctx.moveTo(rotation.x, frame.y);
  ctx.lineTo(rotation.x, rotation.y);
  ctx.stroke();
  for (const point of corners) {
    const side = 5 * unit;
    ctx.beginPath();
    ctx.roundRect(point.x - side / 2, point.y - side / 2, side, side, unit);
    ctx.fill(); ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(rotation.x, rotation.y, 3 * unit, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
