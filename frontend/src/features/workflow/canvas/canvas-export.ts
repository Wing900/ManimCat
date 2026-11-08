import { CANVAS_EXPORT_WIDTH, CANVAS_EXPORT_HEIGHT } from './constants';
import { drawPage } from './canvas-render';
import type { CanvasPage } from './types';

export function renderPageToDataUrl(page: CanvasPage): string {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_EXPORT_WIDTH; canvas.height = CANVAS_EXPORT_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  drawPage(ctx, page);
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

