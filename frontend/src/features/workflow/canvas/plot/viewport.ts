import type { PlotSettings } from '../objects/types';

// Expand every edge by 0.5% of that axis's span; keep the entered ranges intact.
const OVERSCAN_RATIO = 0.005;

export function getPlotViewport(settings: PlotSettings) {
  const xPad = (settings.xMax - settings.xMin) * OVERSCAN_RATIO;
  const yPad = (settings.yMax - settings.yMin) * OVERSCAN_RATIO;
  return {
    xMin: settings.xMin - xPad, xMax: settings.xMax + xPad,
    yMin: settings.yMin - yPad, yMax: settings.yMax + yPad,
  };
}
