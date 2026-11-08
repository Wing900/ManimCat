import type { CanvasObject, Point, ShapeKind } from './types';

export function createShape(kind: ShapeKind, start: Point, end: Point, color: string, width: number): CanvasObject {
  const style = { id: crypto.randomUUID(), color, width };
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (kind === 'circle') {
    const side = Math.min(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx) * side;
    dy = Math.sign(dy) * side;
  }
  const bounds = { x: start.x + Math.min(0, dx), y: start.y + Math.min(0, dy), width: Math.abs(dx), height: Math.abs(dy) };
  switch (kind) {
    case 'line': case 'arrow': return { ...style, kind, start, end };
    case 'circle': case 'ellipse': return { ...style, kind: 'ellipse', bounds, constrained: kind === 'circle' };
    case 'triangle': return {
      ...style, kind: 'polygon', closed: true,
      points: [
        { x: bounds.x + bounds.width / 2, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ],
    };
    default: return { ...style, kind: 'rectangle', bounds };
  }
}

export function arrowHead(object: { start: Point; end: Point; width: number }): Point[] {
  const angle = Math.atan2(object.end.y - object.start.y, object.end.x - object.start.x);
  const length = Math.max(16, object.width * 3);
  return [Math.PI / 6, -Math.PI / 6].map((offset) => ({
    x: object.end.x - length * Math.cos(angle + offset),
    y: object.end.y - length * Math.sin(angle + offset),
  }));
}

export function drawShape(ctx: CanvasRenderingContext2D, object: Exclude<CanvasObject, { kind: 'stroke' | 'text' | 'function' }>) {
  ctx.beginPath();
  switch (object.kind) {
    case 'ellipse': {
      const b = object.bounds;
      ctx.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, 0, 0, Math.PI * 2);
      break;
    }
    case 'rectangle': {
      const b = object.bounds;
      ctx.rect(b.x, b.y, b.width, b.height);
      break;
    }
    case 'line': case 'arrow':
      ctx.moveTo(object.start.x, object.start.y);
      ctx.lineTo(object.end.x, object.end.y);
      if (object.kind === 'arrow') {
        const [a, b] = arrowHead(object);
        ctx.moveTo(a.x, a.y); ctx.lineTo(object.end.x, object.end.y); ctx.lineTo(b.x, b.y);
      }
      break;
    case 'polygon':
      object.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      if (object.closed) ctx.closePath();
      break;
  }
  ctx.stroke();
}
