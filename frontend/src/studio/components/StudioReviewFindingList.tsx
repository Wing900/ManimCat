import type { StudioReviewFinding } from '../protocol/studio-review-types'
import { studioSeverityBadge } from '../theme'

interface StudioReviewFindingListProps {
  findings: StudioReviewFinding[]
}

export function StudioReviewFindingList({ findings }: StudioReviewFindingListProps) {
  if (!findings.length) {
    return <div className="text-sm text-text-secondary">No structured findings.</div>
  }

  return (
    <div className="space-y-3">
      {findings.map((finding, index) => (
        <article key={`${finding.code}-${finding.path ?? 'inline'}-${index}`} className="rounded-2xl border border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioSeverityBadge(finding.severity)}`}>{finding.severity}</span>
            <span className="text-sm font-semibold text-text-primary">{finding.title}</span>
            <span className="text-xs text-text-secondary">{finding.code}</span>
          </div>
          <div className="mt-2 text-sm text-text-secondary">
            {formatFindingLocation(finding)}
          </div>
          <div className="mt-3 text-sm leading-6 text-text-primary">{finding.rationale}</div>
          <div className="mt-2 text-sm text-text-secondary">Recommendation: {finding.recommendation}</div>
        </article>
      ))}
    </div>
  )
}

function formatFindingLocation(finding: StudioReviewFinding): string {
  const base = finding.path ?? 'Inline review target'
  if (finding.range) {
    return `${base}:${finding.range.start}-${finding.range.end}`
  }
  if (finding.line) {
    return `${base}:${finding.line}`
  }
  return base
}
