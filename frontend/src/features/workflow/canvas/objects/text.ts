import type { Bounds, TextObject } from './types';

export function textFont(fontSize: number): string { return `${fontSize}px sans-serif`; }

export function layoutText(object: TextObject, measure: (text: string) => number): string[] {
  if (!object.boxWidth) return object.text.split('\n');
  const lines: string[] = [];
  for (const paragraph of object.text.split('\n')) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character) > object.boxWidth) { lines.push(line); line = ''; }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

export function textBounds(object: TextObject, measure?: (text: string) => number): Bounds {
  // Measurement is supplied by the surface; fallback keeps geometry usable without DOM.
  const measureLine = measure ?? ((line: string) => Array.from(line).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : 0.65), 0) * object.fontSize);
  const lines = layoutText(object, measureLine);
  const widths = lines.map(measureLine);
  return { x: object.position.x, y: object.position.y, width: object.boxWidth ?? Math.max(object.fontSize, ...widths), height: lines.length * object.fontSize * 1.3 };
}

export function drawText(ctx: CanvasRenderingContext2D, object: TextObject) {
  ctx.font = textFont(object.fontSize);
  ctx.textBaseline = 'top';
  ctx.fillStyle = object.color;
  layoutText(object, (line) => ctx.measureText(line).width).forEach((line, index) => ctx.fillText(line, object.position.x, object.position.y + index * object.fontSize * 1.3));
}
