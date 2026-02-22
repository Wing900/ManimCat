import { useMemo, useState } from 'react';
import type { JobTimings } from '../types/api';

const timingLabels: Array<{ key: keyof JobTimings; label: string }> = [
  { key: 'analyze', label: '分析' },
  { key: 'edit', label: '修改' },
  { key: 'retry', label: '代码生成' },
  { key: 'render', label: '渲染' },
  { key: 'store', label: '存储' },
];

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

interface TimingPanelProps {
  timings: JobTimings;
}

export function TimingPanel({ timings }: TimingPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { total, items } = useMemo(() => {
    const items = timingLabels
      .map(({ key, label }) => ({ key, label, value: timings[key] }))
      .filter((item) => typeof item.value === 'number');

    const total = typeof timings.total === 'number'
      ? timings.total
      : items.reduce((sum, item) => sum + (item.value || 0), 0);

    return { total, items };
  }, [timings]);

  if (!items.length) {
    return null;
  }

  return (
    <div className="fixed left-4 bottom-4 z-40">
      <div className="relative">
        <div
          className={`absolute left-0 bottom-full mb-2 w-56 rounded-2xl bg-bg-secondary/90 text-xs text-text-secondary shadow-lg shadow-black/10 border border-bg-secondary/60 backdrop-blur px-4 py-3 space-y-2 origin-bottom-left transition-all duration-200 ease-out ${
            isOpen
              ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
              : 'opacity-0 translate-y-2 scale-95 pointer-events-none'
          }`}
          aria-hidden={!isOpen}
        >
          {items.map((item) => (
            <div key={item.key} className="flex items-center justify-between">
              <span>{item.label}</span>
              <span className="text-text-primary font-medium">{formatDuration(item.value!)}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-bg-secondary/80 text-xs text-text-secondary/90 shadow-lg shadow-black/10 backdrop-blur border border-bg-secondary/60 hover:text-text-primary hover:bg-bg-secondary transition-colors"
        >
          <span className="text-[11px] tracking-wide">耗时</span>
          <span className="text-text-primary font-medium">{formatDuration(total)}</span>
          <svg
            className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
