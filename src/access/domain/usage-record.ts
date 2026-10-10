/**
 * Token usage, in the one shape both pipelines already produce.
 *
 * The Workflow side computes `JobTokenUsageSummary.totals` and the Studio side computes
 * `StudioTokenUsage`. They carry the same five counter names, which is why the access module
 * needs no per-pipeline adapter logic: a caller passes the totals it already has.
 */

export type UsageSourceKind = 'workflow_job' | 'studio_run'

export interface TokenUsageTotals {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
  readonly measuredCalls: number
  readonly unmeasuredCalls: number
}

export interface UsageRecordInput extends TokenUsageTotals {
  readonly catKeyId: string
  readonly sourceKind: UsageSourceKind
  /** Workflow Job id or Studio Run id. The checkpoint key, not an append key. */
  readonly sourceId: string
  /** Always the CatKey upstream model: in CatKey mode the model is fixed, so no caller supplies it. */
  readonly model: string
}
