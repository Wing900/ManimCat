export interface PlotRenderInput {
  workspaceDirectory: string
  renderId: string
  code: string
  signal?: AbortSignal
}

export interface PlotRenderExecution {
  outputDir: string
  scriptPath: string
  imageDataUris: string[]
  imagePaths: string[]
  stdout: string
  stderr: string
}

export interface PlotRenderPort {
  execute: (input: PlotRenderInput) => Promise<PlotRenderExecution>
}

export function createUnconfiguredPlotRenderPort(): PlotRenderPort {
  return {
    async execute() {
      throw new Error('Matplotlib render port is not configured')
    }
  }
}
