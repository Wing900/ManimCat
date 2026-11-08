import { distancePointToSegment, eraseStrokeWithCircle } from '../canvas-geometry';
import { arrowHead } from './shape';
import { textBounds, textFont } from './text';
import { getTransform, toLocalPoint, transformScale } from './object-transform';
import type { Bounds, CanvasObject, Point } from './types';

export function getObjectBounds(object: CanvasObject, ctx?: CanvasRenderingContext2D): Bounds {
  if (object.kind === 'function') return { ...object.bounds, y: object.bounds.y - 28, height: object.bounds.height + 28 };
  if ('bounds' in object) return object.bounds;
  if (object.kind === 'text') {
    if (!ctx) return textBounds(object);
    ctx.save(); ctx.font = textFont(object.fontSize);
    const bounds = textBounds(object, (line) => ctx.measureText(line).width);
    ctx.restore(); return bounds;
  }
  const points = 'points' in object ? object.points : [object.start, object.end, ...(object.kind === 'arrow' ? arrowHead(object) : [])];
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function nearPolyline(points: Point[], point: Point, tolerance: number, closed = false): boolean {
  if (points.length === 1) return Math.hypot(points[0].x - point.x, points[0].y - point.y) <= tolerance;
  for (let i = 1; i < points.length; i++) if (distancePointToSegment(point, points[i - 1], points[i]) <= tolerance) return true;
  return closed && points.length > 2 && distancePointToSegment(point, points[points.length - 1], points[0]) <= tolerance;
}

export function hitObject(object: CanvasObject, point: Point, radius = 6, ctx?: CanvasRenderingContext2D): boolean {
  point = toLocalPoint(object, point);
  radius /= transformScale(object);
  const tolerance = radius + object.width * (object.kind === 'stroke' ? 0.95 : 0.5);
  const b = getObjectBounds(object, ctx);
  if (point.x < b.x - tolerance || point.x > b.x + b.width + tolerance || point.y < b.y - tolerance || point.y > b.y + b.height + tolerance) return false;
  switch (object.kind) {
    case 'stroke': return nearPolyline(object.points, point, tolerance);
    case 'polygon': return nearPolyline(object.points, point, tolerance, object.closed);
    case 'line': case 'arrow': return nearPolyline([object.start, object.end], point, tolerance)
      || (object.kind === 'arrow' && nearPolyline([arrowHead(object)[0], object.end, arrowHead(object)[1]], point, tolerance));
    case 'ellipse': {
      const rx = b.width / 2, ry = b.height / 2;
      if (!rx || !ry) return false;
      const dx = point.x - b.x - rx, dy = point.y - b.y - ry;
      const angle = Math.atan2(dy / ry, dx / rx);
      return Math.hypot(dx - rx * Math.cos(angle), dy - ry * Math.sin(angle)) <= tolerance;
    }
    case 'rectangle': return nearPolyline([
      { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
    ], point, tolerance, true);
    default: return true;
  }
}

export function findObjectAtPoint(objects: CanvasObject[], point: Point, ctx?: CanvasRenderingContext2D): CanvasObject | null {
  for (let i = objects.length - 1; i >= 0; i--) if (hitObject(objects[i], point, 6, ctx)) return objects[i];
  return null;
}

export function moveObject(object: CanvasObject, dx: number, dy: number): CanvasObject {
  if (object.transform) {
    const transform = getTransform(object);
    return { ...object, transform: { ...transform, e: transform.e + dx, f: transform.f + dy } };
  }
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  if ('bounds' in object) return { ...object, bounds: { ...object.bounds, x: object.bounds.x + dx, y: object.bounds.y + dy } };
  if ('points' in object) return { ...object, points: object.points.map(move) };
  if (object.kind === 'text') return { ...object, position: move(object.position) };
  return { ...object, start: move(object.start), end: move(object.end) };
}

export function eraseObjects(objects: CanvasObject[], point: Point, radius: number, ctx?: CanvasRenderingContext2D): CanvasObject[] {
  let changed = false;
  const result = objects.flatMap((object): CanvasObject[] => {
    if (!hitObject(object, point, radius, ctx)) return [object];
    changed = true;
    return object.kind === 'stroke' ? eraseStrokeWithCircle(object, toLocalPoint(object, point), radius / transformScale(object) + object.width / 2) : [];
  });
  return changed ? result : objects;
}
