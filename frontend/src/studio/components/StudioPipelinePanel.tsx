import { useI18n } from '../../i18n';
import type { StudioTaskItem } from '../types';

interface StudioPipelinePanelProps {
  tasks: StudioTaskItem[];
}

export function StudioPipelinePanel({ tasks }: StudioPipelinePanelProps) {
  const { t } = useI18n();

  function getTaskTone(status: StudioTaskItem['status']): string {
    switch (status) {
      case 'completed':
        return 'text-green-500/60';
      case 'failed':
        return 'text-red-500/60';
      case 'running':
        return 'text-accent-rgb animate-pulse';
      default:
        return 'text-text-secondary/45';
    }
  }

  return (
    <aside className="w-[260px] shrink-0 border-l border-border/5 px-8 pt-12 pb-8 flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <span className="text-[10px] uppercase tracking-[0.4em] text-text-secondary/40 font-medium">
          {t('studio.pipeline.title')}
        </span>
        <p className="text-[11px] uppercase tracking-[0.25em] text-text-secondary/25 font-light">
          {t('studio.pipeline.autoUpdate')}
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-3 -mx-4">
        {tasks.map((task) => (
          <div 
            key={task.id} 
            className="group px-4 py-5 rounded-2xl transition-all hover:bg-bg-secondary/40 border border-transparent hover:border-border/5"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-medium tracking-[0.02em] text-text-primary/70">
                {task.label}
              </p>
              {task.status === 'running' && (
                <div className="h-2 w-2 rounded-full bg-accent-rgb shadow-[0_0_8px_rgba(var(--accent-rgb),0.4)]" />
              )}
            </div>
            
            <p className={`text-[9px] font-mono tracking-widest uppercase ${getTaskTone(task.status)}`}>
              {task.status === 'completed' ? `${task.detail} ✓` : task.detail}
            </p>

            {typeof task.progress === 'number' && task.status === 'running' && (
              <div className="mt-4 overflow-hidden h-1.5 w-full bg-bg-secondary/60 rounded-full border border-border/5">
                <div
                  className="h-full bg-accent-rgb transition-all duration-700 ease-in-out rounded-full shadow-[0_0_12px_rgba(var(--accent-rgb),0.3)]"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-6 rounded-3xl bg-accent-rgb/[0.03] border border-accent-rgb/5">
        <p className="text-[10px] leading-5 text-accent-rgb/40 text-center font-light italic">
          Project syncing in real-time.
        </p>
      </div>
    </aside>
  );
}
