import { createLogger } from '../../../shared/logging/logger'
import { logTimeline } from './plot-studio-timing'
import type { StudioTelemetry } from './studio-telemetry'

const logger = createLogger('StudioTiming')
const TIMED_EVENTS = new Set([
  'http.scene_run.requested', 'http.scene_run.accepted', 'run.accepted', 'run.started',
  'step.started', 'step.response', 'provider.completed', 'provider.failed',
  'assistant.first_text', 'tool.failure.detected',
])

/** Both modes share the same timing contract. No prompt, reply, credential or token delta logs. */
export function createStudioTelemetryAdapter(): StudioTelemetry {
  return {
    event({ studioKind, name, data, level }) {
      if (TIMED_EVENTS.has(name)) logger[level ?? 'info'](name, { studioKind, ...data })
    },
    timeline({ studioKind, name, detail }) {
      logTimeline(studioKind, name, detail)
    },
  }
}
