import type { Bounds, PlotSettings, Point } from '../objects/types';
import { compileExpression } from './expression';
import { getPlotViewport } from './viewport';

export function validatePlot(settings: PlotSettings): void {
  const { xMin, xMax, yMin, yMax } = settings;
  const values = [xMin, xMax, yMin, yMax];
  if (!values.every(Number.isFinite) || values.some((v) => Math.abs(v) > 1e9)
    || xMax - xMin < 1e-6 || yMax - yMin < 1e-6) throw new Error('Invalid coordinate range');
  compileExpression(settings.expression);
}

/** Local pixel coordinates, broken at undefined points and unresolved discontinuities. */
export function sampleFunction(settings: PlotSettings, size: Pick<Bounds, 'width' | 'height'>, pixelScale = 1): Point[][] {
  const fn = compileExpression(settings.expression);
  const { width, height } = size;
  const { xMin, xMax, yMin, yMax } = getPlotViewport(settings);
  const segments: Point[][] = [];
  let current: Point[] = [];
  let budget = 24000;
  const evaluate = (px: number): Point => ({ x: px, y: height * (yMax - fn(xMin + px / width * (xMax - xMin))) / (yMax - yMin) });
  const flush = () => { if (current.length > 1) segments.push(current); current = []; };
  const append = (a: Point, b: Point) => {
    if (!current.length) current.push(a);
    current.push(b);
  };
  function visit(a: Point, b: Point, depth: number) {
    if (--budget < 0) { flush(); return; }
    const mid = evaluate((a.x + b.x) / 2);
    const finite = [a.y, mid.y, b.y].every(Number.isFinite);
    // Entirely undefined intervals must not consume the refinement budget before
    // reaching the valid portion of sqrt(x), ln(x), etc.
    if (![a.y, mid.y, b.y].some(Number.isFinite)) { flush(); return; }
    // Offscreen intervals still get subdivided when crossing the viewport/poles.
    const sameOutside = finite && ((a.y < -height && mid.y < -height && b.y < -height)
      || (a.y > height * 2 && mid.y > height * 2 && b.y > height * 2));
    if (sameOutside) { flush(); return; }
    const error = Math.abs(mid.y - (a.y + b.y) / 2);
    const jump = Math.max(Math.abs(a.y - mid.y), Math.abs(mid.y - b.y));
    if (!finite || error * pixelScale > 0.65 || jump > height / 3) {
      if (depth < 10 && b.x - a.x > 0.002 / pixelScale) {
        visit(a, mid, depth + 1); visit(mid, b, depth + 1);
      } else flush();
      return;
    }
    append(a, b);
  }
  const steps = Math.max(128, Math.min(512, Math.ceil(width * pixelScale / 3)));
  let previous = evaluate(0);
  for (let i = 1; i <= steps && budget > 0; i++) {
    const next = evaluate(i / steps * width);
    visit(previous, next, 0);
    previous = next;
  }
  flush();
  return segments;
}
