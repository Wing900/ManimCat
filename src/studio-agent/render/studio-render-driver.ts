import type { StudioKind } from '../domain/core-types'
import type { StudioFileAttachment, StudioRender } from '../domain/types'
import type { StudioRenderResult } from './render-result-types'

/**
 * One Mode's render lifecycle behind a neutral interface.
 *
 * The shared Run/Render layer resolves a driver by `kind` and calls `cancel` or `reconcile`
 * without knowing whether the render is a queued Manim job or an inline Matplotlib script. The
 * render Tools call `execute` with their own schema's input, so the Tool stays kind-specific
 * while the driver carries the Port.
 */
export interface StudioRenderDriver {
  readonly kind: StudioKind
  execute(input: StudioRenderExecutionInput): Promise<StudioRenderExecutionResult>
  cancel?(jobId: string): Promise<'cancelled' | 'completed' | 'failed'>
  reconcile?(jobId: string): Promise<StudioRenderResult>
}

export interface StudioRenderExecutionInput {
  render: StudioRender
  workspaceDirectory: string
  code: string
  signal?: AbortSignal
}

export interface StudioRenderExecutionResult {
  /** Queued Manim job id; absent for inline Matplotlib renders. */
  jobId?: string
  /** Manim: `queued`. Matplotlib: `completed`. */
  status: 'queued' | 'completed'
  /** Matplotlib: the images the inline run produced. */
  attachments?: StudioFileAttachment[]
  /** Matplotlib: workspace-relative paths and counts for the render metadata. */
  metadata?: Record<string, unknown>
}

/** Resolves a driver by Studio kind. The shared layer never imports a concrete port. */
export interface StudioRenderDriverRegistry {
  resolve(kind: StudioKind): StudioRenderDriver | undefined
}

export function createStudioRenderDriverRegistry(
  drivers: readonly StudioRenderDriver[]
): StudioRenderDriverRegistry {
  const byKind = new Map<StudioKind, StudioRenderDriver>(drivers.map((driver) => [driver.kind, driver]))
  return {
    resolve(kind: StudioKind) {
      return byKind.get(kind)
    }
  }
}