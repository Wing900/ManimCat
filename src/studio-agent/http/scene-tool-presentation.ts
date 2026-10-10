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
 * the model context and the persisted Tool result keep the full internal value. The trusted Tool name
 * is carried for callers that need to attribute the result; the rule below reads only the status.
 *
 * Rules:
 * - a failed Tool publishes no result text at all, so a traceback or a private path can never ride
 *   along on `output`;
 * - every other Tool publishes its output unchanged: that text is the working result the user asked
 *   for (`read`, `grep`, listings, renders). This module therefore makes no claim that arbitrary
 *   Tool output is path-free.
 */

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

  return { title: input.title, output: input.output, metadata: input.metadata }
}
