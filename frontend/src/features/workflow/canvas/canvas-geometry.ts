import type { Point, StrokeObject } from './types';

export function distancePointToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projectedX = start.x + clamped * dx;
  const projectedY = start.y + clamped * dy;
  return Math.hypot(point.x - projectedX, point.y - projectedY);
}

export function findStrokeAtPoint(strokes: StrokeObject[], point: Point): StrokeObject | null {
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index];
    if (stroke.points.length === 1) {
      const [single] = stroke.points;
      if (Math.hypot(point.x - single.x, point.y - single.y) <= stroke.width + 6) {
        return stroke;
      }
      continue;
    }

    for (let i = 1; i < stroke.points.length; i += 1) {
      const distance = distancePointToSegment(point, stroke.points[i - 1], stroke.points[i]);
      if (distance <= stroke.width / 2 + 6) {
        return stroke;
      }
    }
  }

  return null;
}

function isPointInsideCircle(point: Point, center: Point, radius: number): boolean {
  return Math.hypot(point.x - center.x, point.y - center.y) <= radius;
}

export function eraseStrokeWithCircle(stroke: StrokeObject, center: Point, radius: number): StrokeObject[] {
  if (stroke.points.length === 0) {
    return [stroke];
  }

  if (stroke.points.length === 1) {
    return isPointInsideCircle(stroke.points[0], center, radius) ? [] : [stroke];
  }

  const nextStrokes: StrokeObject[] = [];
  let currentSegment: Point[] = [];
  let segmentIndex = 0;

  for (let index = 0; index < stroke.points.length; index += 1) {
    const current = stroke.points[index];
    const currentInside = isPointInsideCircle(current, center, radius);
    const previous = index > 0 ? stroke.points[index - 1] : null;

    if (currentInside) {
      if (currentSegment.length > 0) {
        nextStrokes.push({
          ...stroke,
          id: `${stroke.id}-seg-${segmentIndex}`,
          points: currentSegment,
        });
        currentSegment = [];
        segmentIndex += 1;
      }
      continue;
    }

    if (previous) {
      const crossesEraseCircle = distancePointToSegment(center, previous, current) <= radius;
      if (crossesEraseCircle && currentSegment.length > 0) {
        nextStrokes.push({
          ...stroke,
          id: `${stroke.id}-seg-${segmentIndex}`,
          points: currentSegment,
        });
        currentSegment = [];
        segmentIndex += 1;
      }
    }

    currentSegment.push(current);
  }

  if (currentSegment.length > 0) {
    nextStrokes.push({
      ...stroke,
      id: `${stroke.id}-seg-${segmentIndex}`,
      points: currentSegment,
    });
  }

  return nextStrokes.filter((item) => item.points.length > 0);
}
