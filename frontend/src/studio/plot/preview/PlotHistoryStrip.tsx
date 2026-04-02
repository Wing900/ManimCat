import { useI18n } from '../../../i18n'

interface PlotHistoryEntry {
  workId: string
  title: string
  imageIndex: number
  attachment: {
    path: string
    name?: string
  }
}

interface PlotHistoryStripProps {
  entries: PlotHistoryEntry[]
  selectedWorkId: string | null
  selectedImageIndex: number
  draggingWorkId: string | null
  onSelect: (workId: string, imageIndex: number) => void
  onDragStart: (workId: string) => void
  onDrop: (workId: string) => void
  onDragEnd: () => void
}

export function PlotHistoryStrip({
  entries,
  selectedWorkId,
  selectedImageIndex,
  draggingWorkId,
  onSelect,
  onDragStart,
  onDrop,
  onDragEnd,
}: PlotHistoryStripProps) {
  const { t } = useI18n()

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.4em] text-text-secondary/35">{t('studio.plot.history')}</div>
          <div className="h-px w-8 bg-border/10" />
          <span className="font-mono text-[10px] text-text-secondary/40">
            {entries.length.toString().padStart(2, '0')}
          </span>
        </div>
      </div>

      <div className="mt-4 flex min-w-0 gap-4 overflow-x-auto pb-4 pt-1">
        {entries.map((entry, index) => {
          const selected = entry.workId === selectedWorkId && entry.imageIndex === selectedImageIndex
          return (
            <button
              key={`${entry.workId}-${entry.imageIndex}-${entry.attachment.path}`}
              type="button"
              draggable
              onClick={() => onSelect(entry.workId, entry.imageIndex)}
              onDragStart={() => onDragStart(entry.workId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDrop(entry.workId)}
              onDragEnd={onDragEnd}
              className={`group relative flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-all duration-500 ${
                selected
                  ? 'scale-[0.96] border border-accent/25 bg-bg-secondary/60 shadow-inner'
                  : 'border border-transparent bg-bg-secondary/30 hover:scale-[0.98] hover:bg-bg-secondary/50'
              } ${draggingWorkId === entry.workId ? 'opacity-50' : ''}`}
            >
              <img
                src={entry.attachment.path}
                alt={entry.attachment.name ?? entry.title}
                className={`h-full w-full object-cover transition-transform duration-700 ${selected ? 'scale-100' : 'scale-110 opacity-60 group-hover:scale-100 group-hover:opacity-100'}`}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-2 py-1 text-left">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/80">
                  {String(index + 1).padStart(2, '0')}
                </div>
              </div>
              {selected && <div className="pointer-events-none absolute inset-0 bg-accent/5" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
