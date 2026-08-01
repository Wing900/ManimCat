import { executeMatplotlibRender } from '../../services/plot-runtime/matplotlib-executor'
import type { PlotRenderPort } from './plot-render-port'

export function createMatplotlibPlotRenderPort(): PlotRenderPort {
  return {
    execute: executeMatplotlibRender
  }
}
