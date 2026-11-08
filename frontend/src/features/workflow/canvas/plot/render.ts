import type { FunctionPlotObject, Point } from '../objects/types';
import { sampleFunction } from './sampling';

const cache = new WeakMap<FunctionPlotObject, { resolution: number; segments: Point[][] }>();

/** Shared by the editor preview, document surface, thumbnails and PNG export. */
export function drawFunctionPlot(ctx: CanvasRenderingContext2D, object: FunctionPlotObject) {
  const { bounds } = object;
  ctx.save();
  ctx.translate(bounds.x, bounds.y);
  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();
  const matrix = ctx.getTransform();
  const resolution = Math.max(1, Math.min(8, Math.hypot(matrix.a, matrix.b)));
  let sampled = cache.get(object);
  if (!sampled || sampled.resolution !== resolution) {
    sampled = { resolution, segments: sampleFunction(object, bounds, resolution) };
    cache.set(object, sampled);
  }
  ctx.strokeStyle = object.color;
  ctx.lineWidth = object.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  sampled.segments.forEach((segment) => segment.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }));
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.font = '18px sans-serif';
  ctx.fillStyle = object.color;
  ctx.textBaseline = 'bottom';
  ctx.fillText(`y = ${object.expression.replace(/^y\s*=\s*/i, '')}`, bounds.x + 8, bounds.y - 5, bounds.width - 16);
  ctx.restore();
}
