import { useI18n } from '../../i18n'
import type { StudioRender } from '../protocol/studio-agent-types'
import { studioStatusBadge } from '../theme'
import { translateWorkStatus } from '../labels'

interface RenderHistoryProps {
  renders: StudioRender[]
  selectedRenderId: string | null
  onSelectRender: (renderId: string) => void
}

export function RenderHistory({ renders, selectedRenderId, onSelectRender }: RenderHistoryProps) {
  const { t } = useI18n()

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary/35">{t('studio.plot.history')}</div>
        <div className="font-mono text-[10px] text-text-secondary/40">{renders.length.toString().padStart(2, '0')}</div>
      </div>

      <div className="mt-6 min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
        {renders.map((render) => {
          const selected = render.id === selectedRenderId
          const attachment = render.attachments?.find(isImageAttachment)

          return (
            <button
              key={render.id}
              type="button"
              onClick={() => onSelectRender(render.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-300 ${
                selected ? 'bg-bg-secondary/40 shadow-sm' : 'hover:bg-bg-secondary/20'
              }`}
            >
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-bg-secondary/35">
                {attachment ? (
                  <img src={attachment.path} alt={render.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.2em] text-text-secondary/40">
                    {render.outputMode}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[12px] font-bold ${selected ? 'text-text-primary' : 'text-text-primary/60'}`}>
                  {render.title}
                </div>
                <div className="mt-1 truncate text-[10px] text-text-secondary/45">{render.concept}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter ${studioStatusBadge(render.status)}`}>
                {translateWorkStatus(render.status, t)}
              </span>
            </button>
          )
        })}
        {renders.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-10 text-[10px] uppercase tracking-[0.28em] text-text-secondary/35">
            {t('studio.waitingOutput')}
          </div>
        )}
      </div>
    </section>
  )
}

function isImageAttachment(attachment: { path: string; mimeType?: string }) {
  return Boolean(attachment.mimeType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(attachment.path))
}
