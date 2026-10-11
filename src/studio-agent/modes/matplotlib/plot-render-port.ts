export interface PlotRenderInput {
  workspaceDirectory: string
  workspaceOutputDirectory?: string
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
