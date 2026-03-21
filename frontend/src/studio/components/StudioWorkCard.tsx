import type { StudioTask, StudioWork, StudioWorkResult } from '../protocol/studio-agent-types'
import { formatStudioTime, studioStatusBadge, truncateStudioText } from '../theme'

interface StudioWorkCardProps {
  work: StudioWork
  latestTask?: StudioTask | null
  result?: StudioWorkResult | null
  selected: boolean
  onSelect: (workId: string) => void
}

export function StudioWorkCard({ work, latestTask, result, selected, onSelect }: StudioWorkCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(work.id)}
      className={`w-full rounded-3xl border p-4 text-left transition ${
        selected
          ? 'border-sky-500/30 bg-sky-500/10 shadow-[0_16px_40px_rgba(14,165,233,0.12)]'
          : 'border-black/10 bg-white/70 hover:border-black/20 hover:bg-white/90 dark:border-white/10 dark:bg-white/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-text-secondary">{work.type}</div>
          <div className="mt-1 text-base font-semibold text-text-primary">{work.title}</div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${studioStatusBadge(work.status)}`}>{work.status}</span>
      </div>

      <div className="mt-3 text-sm text-text-secondary">
        <div>Updated {formatStudioTime(work.updatedAt)}</div>
        <div className="mt-1">{latestTask ? `Task: ${latestTask.title}` : 'No linked task yet'}</div>
        <div className="mt-1 text-text-primary">{result ? truncateStudioText(result.summary, 90) : 'No result yet'}</div>
      </div>
    </button>
  )
}
