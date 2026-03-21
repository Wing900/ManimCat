export interface StudioReviewLineRange {
  start: number
  end: number
}

export type StudioReviewSeverity = 'high' | 'medium' | 'low'

export interface StudioReviewFinding {
  code: string
  severity: StudioReviewSeverity
  title: string
  rationale: string
  recommendation: string
  path?: string
  line?: number
  range?: StudioReviewLineRange
}

export interface StudioReviewReport {
  summary: string
  findings: StudioReviewFinding[]
}

export interface StudioReviewChangeSet {
  before?: string
  after?: string
  diff?: string
}

export type StudioReviewSourceKind = 'file' | 'inline' | 'change-set'

export interface StudioReviewMetadata {
  report?: string
  review?: StudioReviewReport
  findings?: StudioReviewFinding[]
  path?: string
  sourceLabel?: string
  sourceKind?: StudioReviewSourceKind
  changeSet?: StudioReviewChangeSet
}
