import { CANVAS_EXPORT_WIDTH, CANVAS_EXPORT_HEIGHT, CANVAS_PAPER_COLOR } from './constants';
import type { CanvasPage, CanvasObject } from './types';
import { drawStroke } from './objects/stroke';
import { drawShape } from './objects/shape';
import { drawText } from './objects/text';
import { applyObjectTransform } from './objects/object-transform';
import { drawFunctionPlot } from './plot/render';

export function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = CANVAS_PAPER_COLOR;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(70, 70, 70, 0.14)';
  ctx.setLineDash([6, 10]);
  ctx.lineWidth = 1;

  const rowGap = Math.round(height / 16);
  for (let y = rowGap; y < height; y += rowGap) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const colGap = Math.round(width / 22);
  for (let x = colGap; x < width; x += colGap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}

export function drawObject(ctx: CanvasRenderingContext2D, object: CanvasObject) {
  ctx.save();
  applyObjectTransform(ctx, object);
  ctx.strokeStyle = object.color; ctx.lineWidth = object.width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (object.kind) {
    case 'stroke': drawStroke(ctx, object); break;
    case 'text': drawText(ctx, object); break;
    case 'function': drawFunctionPlot(ctx, object); break;
    default: drawShape(ctx, object);
  }
  ctx.restore();
}

export function drawPage(ctx: CanvasRenderingContext2D, page: CanvasPage) {
  drawGrid(ctx, CANVAS_EXPORT_WIDTH, CANVAS_EXPORT_HEIGHT);
  page.objects.forEach((object) => drawObject(ctx, object));
}
