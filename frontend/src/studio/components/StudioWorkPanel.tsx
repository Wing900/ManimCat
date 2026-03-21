import type { StudioTask, StudioWork, StudioWorkResult } from '../protocol/studio-agent-types'
import { studioPanelClass } from '../theme'
import { StudioWorkCard } from './StudioWorkCard'

interface StudioWorkPanelProps {
  works: StudioWork[]
  selectedWorkId: string | null
  tasksById: Record<string, StudioTask>
  resultsById: Record<string, StudioWorkResult>
  onSelectWork: (workId: string) => void
}

export function StudioWorkPanel({
  works,
  selectedWorkId,
  tasksById,
  resultsById,
  onSelectWork,
}: StudioWorkPanelProps) {
  return (
    <section className={studioPanelClass('flex h-full flex-col p-4')}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-text-secondary">Works</div>
          <h2 className="mt-2 text-xl font-semibold text-text-primary">Work-centric view</h2>
        </div>
        <div className="rounded-full bg-black/5 px-3 py-1 text-sm text-text-secondary dark:bg-white/10">{works.length} items</div>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {works.map((work) => (
          <StudioWorkCard
            key={work.id}
            work={work}
            latestTask={work.latestTaskId ? tasksById[work.latestTaskId] ?? null : null}
            result={work.currentResultId ? resultsById[work.currentResultId] ?? null : null}
            selected={selectedWorkId === work.id}
            onSelect={onSelectWork}
          />
        ))}
        {works.length === 0 && <div className="text-sm text-text-secondary">No works yet. Start a run from the command panel.</div>}
      </div>
    </section>
  )
}
