import type { StudioRender, StudioToolResult } from '../domain/types'
import type { StudioRenderStore } from '../domain/store-types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { isStudioRunCancelledError, throwIfStudioRunCancelled } from '../runtime/execution/run-cancellation'
import { publishStudioRenderUpdated } from './render-events'

/** Status a render record takes when its execution throws. A cancelled Run always wins. */
export function studioRenderFailureStatus(error: unknown): 'cancelled' | 'failed' {
  return isStudioRunCancelledError(error) ? 'cancelled' : 'failed'
}

export function studioRenderFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface StudioRenderLifecycleInput {
  context: StudioRuntimeBackedToolContext
  /** Builds the kind-specific record: Manim queues a job, Plot runs a script inline. */
  createRender: () => StudioRender
  /** Runs once the record exists, and builds the Tool result. */
  execute: (render: StudioRender, renderStore: StudioRenderStore) => Promise<StudioToolResult>
  /** Marks the record when `execute` throws. The shell re-raises the error afterwards. */
  markFailed: (render: StudioRender, renderStore: StudioRenderStore, error: unknown) => Promise<void>
}

/**
 * The thin shell both render Tools share: require the render store, create and publish the record,
 * run the kind-specific execution, and mark the record when anything throws. Everything
 * kind-specific — the record, the Port call, the Tool result, the failure transition — stays in the
 * Tool. This is deliberately not a render framework.
 */
export async function executeStudioRenderLifecycle(
  input: StudioRenderLifecycleInput
): Promise<StudioToolResult> {
  const { context } = input
  const renderStore = context.renderStore
  if (!renderStore) {
    throw new Error('Render store is unavailable')
  }

  const render = input.createRender()
  const created = await renderStore.create(render)
  publishStudioRenderUpdated(context.eventBus, created)

  try {
    throwIfStudioRunCancelled(context.abortSignal)
    return await input.execute(render, renderStore)
  } catch (error) {
    await input.markFailed(render, renderStore, error)
    throw error
  }
}
