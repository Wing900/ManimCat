import { CANVAS_EXPORT_HEIGHT, CANVAS_EXPORT_WIDTH } from './constants';
import type { Point } from './types';

export function getCanvasPoint(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * CANVAS_EXPORT_WIDTH / rect.width,
    y: (event.clientY - rect.top) * CANVAS_EXPORT_HEIGHT / rect.height,
  };
}
