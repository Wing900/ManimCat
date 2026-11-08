import type { CanvasObject, ObjectTransform, Point } from './types';

const IDENTITY: ObjectTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function getTransform(object: CanvasObject): ObjectTransform {
  return object.transform ?? IDENTITY;
}

export function transformScale(object: CanvasObject): number {
  const m = getTransform(object);
  return Math.hypot(m.a, m.b);
}

export function toWorldPoint(object: CanvasObject, point: Point): Point {
  const m = getTransform(object);
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f };
}

export function toLocalPoint(object: CanvasObject, point: Point): Point {
  const m = getTransform(object);
  const det = m.a * m.d - m.b * m.c;
  const x = point.x - m.e, y = point.y - m.f;
  return { x: (m.d * x - m.c * y) / det, y: (m.a * y - m.b * x) / det };
}

export function applyObjectTransform(ctx: CanvasRenderingContext2D, object: CanvasObject) {
  const m = getTransform(object);
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
}

/** Compose a world-space uniform scale/rotation around a fixed anchor. */
function around(object: CanvasObject, anchor: Point, scale: number, angle: number): CanvasObject {
  const m = getTransform(object);
  const a = scale * Math.cos(angle), b = scale * Math.sin(angle);
  const c = -b, d = a;
  const e = anchor.x - a * anchor.x - c * anchor.y;
  const f = anchor.y - b * anchor.x - d * anchor.y;
  return { ...object, transform: {
    a: a * m.a + c * m.b, b: b * m.a + d * m.b,
    c: a * m.c + c * m.d, d: b * m.c + d * m.d,
    e: a * m.e + c * m.f + e, f: b * m.e + d * m.f + f,
  } };
}

export function rotateObject(object: CanvasObject, center: Point, angle: number): CanvasObject {
  return around(object, center, 1, angle);
}

export function scaleObject(object: CanvasObject, anchor: Point, scale: number): CanvasObject {
  const current = transformScale(object);
  const safeScale = Math.max(0.02 / current, Math.min(100 / current, scale));
  return around(object, anchor, safeScale, 0);
}
