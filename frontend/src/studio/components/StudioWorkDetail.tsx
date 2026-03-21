import type { StudioTask, StudioWork, StudioWorkResult } from '../protocol/studio-agent-types'
import type { StudioReviewViewModel } from '../store/studio-selectors'
import { formatStudioTime, studioPanelClass, studioStatusBadge } from '../theme'
import { StudioReviewPanel } from './StudioReviewPanel'
import { StudioTaskTimeline } from './StudioTaskTimeline'

interface StudioWorkDetailProps {
  work: StudioWork | null
  result: StudioWorkResult | null
  tasks: StudioTask[]
  review: StudioReviewViewModel | null
}

export function StudioWorkDetail({ work, result, tasks, review }: StudioWorkDetailProps) {
  if (!work) {
    return (
      <section className={studioPanelClass('p-4')}>
        <div className="text-sm text-text-secondary">Select a work to inspect its tasks, results, and review output.</div>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className={studioPanelClass('p-4')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-text-secondary">{work.type}</div>
            <h2 className="mt-2 text-2xl font-semibold text-text-primary">{work.title}</h2>
            <div className="mt-2 text-sm text-text-secondary">Updated {formatStudioTime(work.updatedAt)}</div>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${studioStatusBadge(work.status)}`}>{work.status}</span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <DetailTile label="Latest Task" value={tasks.at(-1)?.title ?? 'None'} />
          <DetailTile label="Current Result" value={result?.summary ?? 'No result yet'} />
        </div>
      </section>

      <section className={studioPanelClass('p-4')}>
        <div className="text-xs uppercase tracking-[0.28em] text-text-secondary">Task Timeline</div>
        <div className="mt-3">
          <StudioTaskTimeline tasks={tasks} />
        </div>
      </section>

      <StudioReviewPanel result={result} review={review} />

      {result && result.kind !== 'review-report' && (
        <section className={studioPanelClass('p-4')}>
          <div className="text-xs uppercase tracking-[0.28em] text-text-secondary">Result Payload</div>
          <div className="mt-3 text-sm text-text-secondary">{result.summary}</div>
          {result.attachments && result.attachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {result.attachments.map((attachment) => (
                <div key={`${attachment.path}-${attachment.name ?? 'file'}`} className="rounded-2xl border border-black/10 bg-black/5 p-3 text-sm dark:border-white/10 dark:bg-white/5">
                  <div className="font-medium text-text-primary">{attachment.name ?? attachment.path}</div>
                  <div className="mt-1 text-text-secondary">{attachment.path}</div>
                </div>
              ))}
            </div>
          )}
          {result.metadata && (
            <pre className="mt-3 overflow-auto rounded-2xl bg-black/5 p-3 text-xs leading-6 text-text-primary dark:bg-white/5">
              {JSON.stringify(result.metadata, null, 2)}
            </pre>
          )}
        </section>
      )}
    </div>
  )
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="text-xs uppercase tracking-[0.2em] text-text-secondary">{label}</div>
      <div className="mt-2 text-sm text-text-primary">{value}</div>
    </div>
  )
}
