import { getStroke } from 'perfect-freehand';
import type { StrokeObject } from './types';
const STROKE_SMOOTHING = 0.62;
const STROKE_STREAMLINE = 0.48;
const STROKE_THINNING = 0.28;

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeObject): void {
  if (stroke.points.length === 0) {
    return;
  }

  ctx.fillStyle = stroke.color;

  if (stroke.points.length === 1) {
    const [point] = stroke.points;
    ctx.beginPath();
    ctx.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const outline = getStroke(
    stroke.points.map((point) => [point.x, point.y] as [number, number]),
    {
      size: stroke.width * 1.85,
      smoothing: STROKE_SMOOTHING,
      streamline: STROKE_STREAMLINE,
      thinning: STROKE_THINNING,
      simulatePressure: true,
      easing: (value) => value,
      last: true,
    }
  );

  if (outline.length === 0) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index += 1) {
    ctx.lineTo(outline[index][0], outline[index][1]);
  }
  ctx.closePath();
  ctx.fill();
}

