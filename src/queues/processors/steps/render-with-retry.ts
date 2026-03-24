import { createRetryContext, executeCodeRetry } from '../../../services/code-retry/manager'
import type { OutputMode, PromptOverrides } from '../../../types'

export interface RenderAttemptResult {
  success: boolean
  stderr: string
  stdout: string
  peakMemoryMB: number
  exitCode?: number
  codeSnippet?: string
}

interface RenderFailureLogArgs {
  attempt: number
  code: string
  codeSnippet?: string
  stderr: string
  stdout: string
  peakMemoryMB: number
  exitCode?: number
  promptRole: 'codeRetry' | 'single-render'
}

interface ExecuteRenderWithRetryArgs {
  concept: string
  outputMode: OutputMode
  sceneDesign?: string
  promptOverrides?: PromptOverrides
  customApiConfig?: unknown
  initialCode: string
  usedAI: boolean
  timings?: Record<string, number>
  renderCode: (code: string) => Promise<RenderAttemptResult>
  logRenderFailure: (args: RenderFailureLogArgs) => Promise<void>
  ensureJobNotCancelled?: () => Promise<void>
}

export async function executeRenderWithRetry(args: ExecuteRenderWithRetryArgs): Promise<{
  finalCode: string
  renderPeakMemoryMB: number
}> {
  const {
    concept,
    outputMode,
    sceneDesign,
    promptOverrides,
    customApiConfig,
    initialCode,
    usedAI,
    timings,
    renderCode,
    logRenderFailure,
    ensureJobNotCancelled
  } = args

  if (usedAI) {
    const retryContext = createRetryContext(
      concept,
      sceneDesign?.trim() || `概念: ${concept}`,
      promptOverrides,
      outputMode
    )

    const retryManagerResult = await executeCodeRetry(
      retryContext,
      renderCode,
      customApiConfig,
      initialCode,
      async (event) => {
        await logRenderFailure({ ...event, promptRole: 'codeRetry' })
      },
      ensureJobNotCancelled
    )

    if (typeof retryManagerResult.generationTimeMs === 'number' && timings) {
      timings.retry = retryManagerResult.generationTimeMs
    }

    if (!retryManagerResult.success) {
      throw new Error(
        `Code retry failed after ${retryManagerResult.attempts} attempts: ${retryManagerResult.lastError}`
      )
    }

    return {
      finalCode: retryManagerResult.code,
      renderPeakMemoryMB: 0
    }
  }

  const singleAttempt = await renderCode(initialCode)
  if (!singleAttempt.success) {
    await logRenderFailure({
      attempt: 1,
      code: initialCode,
      codeSnippet: singleAttempt.codeSnippet,
      stderr: singleAttempt.stderr,
      stdout: singleAttempt.stdout,
      peakMemoryMB: singleAttempt.peakMemoryMB,
      exitCode: singleAttempt.exitCode,
      promptRole: 'single-render'
    })
    throw new Error(singleAttempt.stderr || 'Manim render failed')
  }

  return {
    finalCode: initialCode,
    renderPeakMemoryMB: singleAttempt.peakMemoryMB
  }
}
