import type { ManimRenderPort, ManimRenderSubmissionInput } from '../../manim/manim-render-port'
import type { PlotRenderExecution, PlotRenderPort } from '../../plot/plot-render-port'

export class FakeManimRenderPort implements ManimRenderPort {
  readonly submissions: ManimRenderSubmissionInput[] = []
  failure: Error | null = null

  async submit(input: ManimRenderSubmissionInput): Promise<{ jobId: string }> {
    this.submissions.push(input)
    if (this.failure) {
      throw this.failure
    }
    return { jobId: input.jobId }
  }
}

export class FakePlotRenderPort implements PlotRenderPort {
  readonly inputs: Array<Parameters<PlotRenderPort['execute']>[0]> = []
  execution: PlotRenderExecution = {
    outputDir: 'renders',
    scriptPath: 'renders/plot.py',
    imageDataUris: [],
    imagePaths: [],
    stdout: '',
    stderr: '',
  }

  async execute(input: Parameters<PlotRenderPort['execute']>[0]): Promise<PlotRenderExecution> {
    this.inputs.push(input)
    return this.execution
  }
}
