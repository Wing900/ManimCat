/**
 * Scene Tool presentation projection.
 *
 * The last public boundary for one Tool result. It answers a single question: which part of a Tool
 * result may an end user see, given the Tool that produced it and its status. The Scene snapshot
 * (a Tool message part) and the Scene event stream (`tool.result`) both route through this function,
 * so the two transports cannot drift into two different redaction rules.
 *
 * The module is pure: it takes the trusted Tool name, the status and the raw result, and returns
 * display fields. It imports no runtime, Tool, port or store module, and it never mutates its input —
 * the model context and the persisted Tool result keep the full internal value.
 *
 * Rules:
 * - a failed Tool publishes no result text at all, so a traceback, a private path or a checker
 *   message can never ride along on `output`;
 * - `static-check` publishes a stable count summary instead of its raw diagnostics, whose message
 *   text is structurally path-bearing (each line reads `tool:line:col <checker message>`);
 * - every other Tool publishes its output unchanged: that text is the working result the user asked
 *   for (`read`, `grep`, listings, renders). This module therefore makes no claim that arbitrary
 *   Tool output is path-free — only the structurally path-bearing static-check result is replaced.
 */

/** Tool name whose raw diagnostics are replaced by a public count summary. */
export const STUDIO_SCENE_STATIC_CHECK_TOOL_NAME = 'static-check'

/** Tool status as seen by the public boundary: the message-part and the streaming vocabularies. */
export type StudioSceneToolPresentationStatus = 'pending' | 'running' | 'completed' | 'error' | 'failed'

export interface StudioSceneToolPresentationInput {
  /** Trusted Tool name: the one the runtime dispatched this call to, never free-form user text. */
  tool: string
  status: StudioSceneToolPresentationStatus
  title?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
}

export interface StudioSceneToolPresentation {
  title?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
}

/**
 * Fail-closed reader of a streaming status value: an unrecognized status is treated as a failure, so
 * an unexpected status string can never widen what is published.
 */
export function readStudioSceneToolPresentationStatus(value: unknown): StudioSceneToolPresentationStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'error' ||
    value === 'failed'
  ) {
    return value
  }
  return 'error'
}

export function projectStudioSceneToolPresentation(
  input: StudioSceneToolPresentationInput
): StudioSceneToolPresentation {
  if (input.status === 'error' || input.status === 'failed') {
    // Status and public media only: the internal result text never crosses a Scene boundary.
    return { metadata: input.metadata }
  }

  if (input.status !== 'completed') {
    return { title: input.title, metadata: input.metadata }
  }

  if (isStudioStaticCheckToolName(input.tool)) {
    return {
      title: input.title,
      output: readStudioStaticCheckSummary(input.metadata),
      metadata: input.metadata
    }
  }

  return { title: input.title, output: input.output, metadata: input.metadata }
}

function isStudioStaticCheckToolName(tool: unknown): boolean {
  return typeof tool === 'string' && tool.trim().toLowerCase() === STUDIO_SCENE_STATIC_CHECK_TOOL_NAME
}

/**
 * Stable public summary of a completed static check, derived only from the trusted numeric count.
 * The raw diagnostic lines stay in the model context and in the persisted Tool result.
 */
function readStudioStaticCheckSummary(metadata: Record<string, unknown> | undefined): string {
  const count = readStudioStaticCheckDiagnosticCount(metadata)
  if (count === undefined) {
    return 'Static check completed.'
  }
  if (count === 0) {
    return 'Static check completed: no diagnostics.'
  }
  return count === 1
    ? 'Static check completed: 1 diagnostic.'
    : `Static check completed: ${count} diagnostics.`
}

function readStudioStaticCheckDiagnosticCount(
  metadata: Record<string, unknown> | undefined
): number | undefined {
  const value = metadata?.diagnosticCount
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return undefined
  }
  return value
}
