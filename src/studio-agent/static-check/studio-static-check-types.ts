import type { OutputMode } from '../../types'
import type { StaticDiagnostic } from '../../services/static-guard/types'
import type { StudioKind } from '../domain/types'

/**
 * Domain-neutral static check request. `kind` travels from the trusted Studio session
 * and is never supplied by model or user input. `outputMode` is a presentation hint:
 * the routed Adapter decides the effective mode and reports it back.
 */
export interface StudioStaticCheckRequest {
  kind: StudioKind
  code: string
  outputMode?: OutputMode
}

export interface StudioStaticCheckResult {
  kind: StudioKind
  outputMode: OutputMode
  diagnostics: StaticDiagnostic[]
}

export interface StudioStaticCheckAdapter {
  check: (request: StudioStaticCheckRequest) => Promise<StudioStaticCheckResult>
}

export interface StudioStaticCheckPort {
  check: (request: StudioStaticCheckRequest) => Promise<StudioStaticCheckResult>
}
