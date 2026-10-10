import { executeMatplotlibRender } from '../../../rendering/matplotlib/matplotlib-executor'
import type { PlotRenderPort } from './plot-render-port'

export function createMatplotlibPlotRenderPort(): PlotRenderPort {
  return {
    execute: executeMatplotlibRender
  }
}
