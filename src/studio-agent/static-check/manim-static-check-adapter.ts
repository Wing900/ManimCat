import type { OutputMode } from '../../types'
import { runStaticChecks } from '../../services/static-guard/checker'
import type { StaticCheckBatch } from '../../services/static-guard/types'
import type {
  StudioStaticCheckAdapter,
  StudioStaticCheckRequest,
  StudioStaticCheckResult
} from './studio-static-check-types'

/** Classic checker shape: image mode splits YON_IMAGE blocks, video checks the file. */
export type ManimStaticCheckRunner = (code: string, outputMode: OutputMode) => Promise<StaticCheckBatch>

/**
 * Manim Adapter. Every Manim semantic — image-block splitting with line offsets, the
 * camera.frame mypy false-positive policy, the py_compile short-circuit — stays owned by
 * `runStaticChecks`. This Adapter only picks the effective output mode and labels the
 * result, so no subprocess or Manim policy is duplicated here.
 */
export class ManimStaticCheckAdapter implements StudioStaticCheckAdapter {
  constructor(private readonly runner: ManimStaticCheckRunner = runStaticChecks) {}

  async check(request: StudioStaticCheckRequest): Promise<StudioStaticCheckResult> {
    const outputMode: OutputMode = request.outputMode === 'image' ? 'image' : 'video'
    const batch = await this.runner(request.code, outputMode)
    return { kind: 'manim', outputMode, diagnostics: batch.diagnostics }
  }
}
