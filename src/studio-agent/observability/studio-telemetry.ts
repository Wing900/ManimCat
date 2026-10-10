import type { StudioKind } from '../domain/core-types'

/**
 * A neutral telemetry event emitted by the shared Runtime. The adapter decides whether
 * to log it, how to label it and where to write it.
 */
export interface StudioTelemetryEvent {
  studioKind: StudioKind
  name: string
  level?: 'info' | 'warn'
  data?: Record<string, unknown>
}

/**
 * The only telemetry surface the shared Runtime knows. `event` is the structured log;
 * `timeline` is the quick one-line trace. Both are no-ops until an adapter is installed.
 */
export interface StudioTelemetry {
  event(input: StudioTelemetryEvent): void
  timeline(input: StudioTelemetryEvent & { detail?: string }): void
}

const noopTelemetry: StudioTelemetry = {
  event() {},
  timeline() {}
}

let current: StudioTelemetry = noopTelemetry

/** Returns the process-level telemetry instance. No-op until an adapter is installed. */
export function getStudioTelemetry(): StudioTelemetry {
  return current
}

/** Installs the process-level telemetry instance. Called once at startup. */
export function setStudioTelemetry(telemetry: StudioTelemetry): void {
  current = telemetry
}

export function readElapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

export function readRunElapsedMs(run: { createdAt?: string }): number | null {
  if (!run.createdAt) {
    return null
  }

  const createdAt = new Date(run.createdAt).getTime()
  if (!Number.isFinite(createdAt)) {
    return null
  }

  return Math.max(0, Date.now() - createdAt)
}