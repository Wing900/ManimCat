import type { StudioWorkResult } from '../protocol/studio-agent-types'
import type { StudioReviewViewModel } from '../store/studio-selectors'
import { studioPanelClass } from '../theme'
import { StudioReviewFindingList } from './StudioReviewFindingList'

interface StudioReviewPanelProps {
  result: StudioWorkResult | null
  review: StudioReviewViewModel | null
}

export function StudioReviewPanel({ result, review }: StudioReviewPanelProps) {
  if (!result || !review) {
    return (
      <section className={studioPanelClass('p-4')}>
        <div className="text-xs uppercase tracking-[0.28em] text-text-secondary">Review</div>
        <div className="mt-3 text-sm text-text-secondary">Structured review output will appear here when the selected work produces a review-report result.</div>
      </section>
    )
  }

  return (
    <section className={studioPanelClass('p-4')}>
      <div className="text-xs uppercase tracking-[0.28em] text-text-secondary">Review</div>
      <h3 className="mt-2 text-lg font-semibold text-text-primary">{result.summary}</h3>
      {(review.sourceLabel || review.path) && (
        <div className="mt-2 text-xs text-text-secondary">
          {review.sourceLabel ?? review.path}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="mb-2 text-sm font-medium text-text-primary">Findings</div>
          <StudioReviewFindingList findings={review.findings} />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
            <div className="text-sm font-medium text-text-primary">Summary</div>
            <div className="mt-2 text-sm text-text-secondary">{review.summary ?? 'No structured summary'}</div>
          </div>

          {review.changeSet && (
            <div className="rounded-2xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="text-sm font-medium text-text-primary">Change Set</div>
              <div className="mt-2 space-y-3 text-xs text-text-secondary">
                {review.changeSet.before && <CodeBlock title="Before" content={review.changeSet.before} />}
                {review.changeSet.after && <CodeBlock title="After" content={review.changeSet.after} />}
                {review.changeSet.diff && <CodeBlock title="Diff" content={review.changeSet.diff} />}
              </div>
            </div>
          )}

          {review.report && <CodeBlock title="Raw Report" content={review.report} />}
        </div>
      </div>
    </section>
  )
}

function CodeBlock({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-[0.2em] text-text-secondary">{title}</div>
      <pre className="overflow-auto rounded-2xl bg-white/70 p-3 text-xs leading-6 text-text-primary dark:bg-black/20">{content}</pre>
    </div>
  )
}
