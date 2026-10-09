import type { OutputMode } from '../../types'
import type { StudioKind } from '../domain/types'
import { throwIfStudioRunCancelled } from '../runtime/execution/run-cancellation'
import { truncateToolText } from '../tools/workspace-paths'
import type { StudioStaticCheckPort, StudioStaticCheckResult } from './studio-static-check-types'

/**
 * The pre-render static check gate.
 *
 * Every render Tool runs this before it reserves anything: the check is part of rendering, so
 * the model cannot forget it and a broken source never costs a queue job, a render record or a
 * displaced notebook. A blocked outcome carries the diagnostics text for the model only; the
 * public Tool row reads a path-free count summary instead (see the Scene Tool presentation).
 */
export interface StudioStaticCheckGateOutcome {
  /** True when the code may be rendered. */
  passed: boolean
  /** Raw check result, kept for the Tool metadata the model sees. */
  result: StudioStaticCheckResult
  /** Bounded diagnostics text; the working result returned to the model when the gate blocks. */
  output: string
}

export async function runStudioStaticCheckGate(input: {
  port: StudioStaticCheckPort
  kind: StudioKind
  code: string
  outputMode?: OutputMode
  signal?: AbortSignal
}): Promise<StudioStaticCheckGateOutcome> {
  throwIfStudioRunCancelled(input.signal)
  const result = await input.port.check({
    kind: input.kind,
    code: input.code,
    outputMode: input.outputMode
  })
  // The checker may finish after Stop was pressed. Its result must not authorize a render.
  throwIfStudioRunCancelled(input.signal)

  return {
    passed: result.diagnostics.length === 0,
    result,
    output: formatStudioStaticDiagnostics(result)
  }
}

/** One line per diagnostic: `tool:line[:column] message`, unchanged from the standalone check. */
export function formatStudioStaticDiagnostics(result: StudioStaticCheckResult): string {
  if (!result.diagnostics.length) {
    return 'No static diagnostics.'
  }

  const summary = result.diagnostics
    .map((item) => `${item.tool}:${item.line}${item.column ? `:${item.column}` : ''} ${item.message}`)
    .join('\n')

  return truncateToolText(summary).text
}
