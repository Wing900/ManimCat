import { getStroke } from 'perfect-freehand';
import { CANVAS_EXPORT_HEIGHT, CANVAS_EXPORT_WIDTH } from './constants';
import type { CanvasPage, Point, StrokeObject } from './types';

const STROKE_SMOOTHING = 0.62;
const STROKE_STREAMLINE = 0.48;
const STROKE_THINNING = 0.28;

export function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = '#fffefb';
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

export function renderPageToDataUrl(page: CanvasPage, selectedStrokeId?: string | null): string {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_EXPORT_WIDTH;
  canvas.height = CANVAS_EXPORT_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  drawGrid(ctx, canvas.width, canvas.height);
  page.strokes.forEach((stroke) => drawStroke(ctx, stroke));

  if (selectedStrokeId) {
    const selected = page.strokes.find((stroke) => stroke.id === selectedStrokeId);
    if (selected) {
      const xs = selected.points.map((point) => point.x);
      const ys = selected.points.map((point) => point.y);
      const minX = Math.min(...xs) - selected.width - 12;
      const maxX = Math.max(...xs) + selected.width + 12;
      const minY = Math.min(...ys) - selected.width - 12;
      const maxY = Math.max(...ys) + selected.width + 12;
      ctx.save();
      ctx.strokeStyle = 'rgba(10, 132, 255, 0.72)';
      ctx.setLineDash([14, 8]);
      ctx.lineWidth = 2;
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
    }
  }

  return canvas.toDataURL('image/png');
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, body] = dataUrl.split(',');
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || 'image/png';
  const bytes = atob(body);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    array[i] = bytes.charCodeAt(i);
  }
  return new File([array], filename, { type: mime });
}

export function getCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_EXPORT_WIDTH / rect.width;
  const scaleY = CANVAS_EXPORT_HEIGHT / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}
