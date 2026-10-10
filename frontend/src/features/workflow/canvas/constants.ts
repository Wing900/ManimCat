import type { CanvasPage } from './types';

export const CANVAS_EXPORT_WIDTH = 1600;
export const CANVAS_EXPORT_HEIGHT = 1000;
export const DEFAULT_COLOR = '#1d1d1f';
export const DEFAULT_WIDTH = 6;
export const ERASER_RADIUS = 24;
export const COLOR_PRESETS = ['#1d1d1f', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#5856d6', '#ff2d55', '#8e8e93'];

export function createPage(): CanvasPage {
  return {
    id: crypto.randomUUID(),
    strokes: [],
  };
}
