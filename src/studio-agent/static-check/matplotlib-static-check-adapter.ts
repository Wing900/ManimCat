import { runPythonStaticChecks, type PythonStaticCheckOptions } from '../../services/static-guard/checker'
import type { StaticCheckBatch } from '../../services/static-guard/types'
import type {
  StudioStaticCheckAdapter,
  StudioStaticCheckRequest,
  StudioStaticCheckResult
} from './studio-static-check-types'

/** Whole-file Python checker shape: one source, optional line offset, no domain policy. */
export type MatplotlibStaticCheckRunner = (
  code: string,
  options?: PythonStaticCheckOptions
) => Promise<StaticCheckBatch>

/**
 * Matplotlib Adapter. A Plot session edits one complete Python file, so the source goes
 * to the shared engine as a single unit: no YON_IMAGE block parsing, no Manim camera
 * false-positive suppression, and no injected ignore predicate (syntax and type results
 * are reported as they are). A Plot artifact is a static figure, so the effective
 * `outputMode` is always `image`, even when the Tool input asks for `video`.
 */
export class MatplotlibStaticCheckAdapter implements StudioStaticCheckAdapter {
  constructor(private readonly runner: MatplotlibStaticCheckRunner = runPythonStaticChecks) {}

  async check(request: StudioStaticCheckRequest): Promise<StudioStaticCheckResult> {
    const batch = await this.runner(request.code)
    return { kind: 'plot', outputMode: 'image', diagnostics: batch.diagnostics }
  }
}
