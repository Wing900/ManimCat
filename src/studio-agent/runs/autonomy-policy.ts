export const DEFAULT_STUDIO_AUTONOMY_MAX_STEPS = 100
export const DEFAULT_STUDIO_AUTONOMY_MAX_CONSECUTIVE_FAILURES = 3

export interface StudioRunAutonomyMetadata {
  mode: 'autonomous'
  stepCount: number
  consecutiveFailures: number
  maxSteps: number
  maxConsecutiveFailures: number
  stopReason?: string
  lastCheckpointAt?: string
}

export interface StudioRunMetadataShape {
  autonomy: StudioRunAutonomyMetadata
  [key: string]: unknown
}

export function createInitialStudioRunMetadata(
  existing?: Record<string, unknown>
): StudioRunMetadataShape {
  return {
    ...(existing ?? {}),
    autonomy: {
      mode: 'autonomous',
      stepCount: 0,
      consecutiveFailures: 0,
      maxSteps: DEFAULT_STUDIO_AUTONOMY_MAX_STEPS,
      maxConsecutiveFailures: DEFAULT_STUDIO_AUTONOMY_MAX_CONSECUTIVE_FAILURES,
      lastCheckpointAt: new Date().toISOString(),
    },
  }
}

export function readStudioRunAutonomyMetadata(metadata: Record<string, unknown> | undefined): StudioRunAutonomyMetadata {
  const candidate = metadata?.autonomy
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return createInitialStudioRunMetadata().autonomy
  }

  const typed = candidate as Record<string, unknown>
  return {
    mode: 'autonomous',
    stepCount: asPositiveInteger(typed.stepCount, 0),
    consecutiveFailures: asPositiveInteger(typed.consecutiveFailures, 0),
    maxSteps: asPositiveInteger(typed.maxSteps, DEFAULT_STUDIO_AUTONOMY_MAX_STEPS),
    maxConsecutiveFailures: asPositiveInteger(typed.maxConsecutiveFailures, DEFAULT_STUDIO_AUTONOMY_MAX_CONSECUTIVE_FAILURES),
    stopReason: typeof typed.stopReason === 'string' ? typed.stopReason : undefined,
    lastCheckpointAt: typeof typed.lastCheckpointAt === 'string' ? typed.lastCheckpointAt : undefined,
  }
}

export function buildStudioRunMetadataPatch(input: {
  metadata: Record<string, unknown> | undefined
  stepCount?: number
  consecutiveFailures?: number
  stopReason?: string | null
}): Record<string, unknown> {
  const autonomy = readStudioRunAutonomyMetadata(input.metadata)
  return {
    ...(input.metadata ?? {}),
    autonomy: {
      ...autonomy,
      stepCount: input.stepCount ?? autonomy.stepCount,
      consecutiveFailures: input.consecutiveFailures ?? autonomy.consecutiveFailures,
      stopReason: input.stopReason === null ? undefined : input.stopReason ?? autonomy.stopReason,
      lastCheckpointAt: new Date().toISOString(),
    },
  }
}

export function isStudioRunResumable(run: {
  status: string
  metadata?: Record<string, unknown>
}): boolean {
  if (run.status === 'running' || run.status === 'pending') {
    return false
  }

  const autonomy = readStudioRunAutonomyMetadata(run.metadata)
  return Boolean(autonomy.stopReason)
}

export function buildStudioContinuationRunMetadata(input: {
  sourceRunId: string
  sourceMetadata?: Record<string, unknown>
}): Record<string, unknown> {
  const sourceAutonomy = readStudioRunAutonomyMetadata(input.sourceMetadata)
  return createInitialStudioRunMetadata({
    continuation: {
      sourceRunId: input.sourceRunId,
      sourceStopReason: sourceAutonomy.stopReason,
      resumedAt: new Date().toISOString(),
    },
  })
}

export function buildStudioContinueInputText(stopReason?: string): string {
  return stopReason
    ? `Continue the interrupted studio task. The previous autonomous run stopped because: ${stopReason}`
    : 'Continue the interrupted studio task from the current workspace state and session history.'
}

function asPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}
