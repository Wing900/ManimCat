import { useMemo, useState } from 'react';
import type { JobTimings, JobTokenUsageSummary } from '../types/api';
import { useI18n } from '../i18n';

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  return String(Math.round(value));
}

interface TimingPanelProps {
  timings?: JobTimings;
  submittedAt?: string | null;
  finishedAt?: string | null;
  tokenUsage?: JobTokenUsageSummary;
}

export function TimingPanel({ timings, submittedAt, finishedAt, tokenUsage }: TimingPanelProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  const { total, items } = useMemo(() => {
    const timingLabels: Array<{ key: keyof JobTimings; label: string }> = [
      { key: 'analyze', label: t('timing.analyze') },
      { key: 'edit', label: t('timing.edit') },
      { key: 'retry', label: t('timing.retry') },
      { key: 'render', label: t('timing.render') },
      { key: 'store', label: t('timing.store') },
    ];

    const items = timingLabels
      .map(({ key, label }) => ({ key, label, value: timings?.[key] }))
      .filter((item) => typeof item.value === 'number');

    const submittedMs = submittedAt ? Date.parse(submittedAt) : Number.NaN;
    const finishedMs = finishedAt ? Date.parse(finishedAt) : Number.NaN;
    const endToEndTotal = Number.isFinite(submittedMs) && Number.isFinite(finishedMs)
      ? Math.max(0, finishedMs - submittedMs)
      : undefined;
    const total = typeof endToEndTotal === 'number'
      ? endToEndTotal
      : typeof timings?.total === 'number'
        ? timings.total
        : items.reduce((sum, item) => sum + (item.value || 0), 0);

    return { total, items };
  }, [finishedAt, submittedAt, t, timings]);

  const tokenTotals = tokenUsage?.totals;
  const hasMeasuredTokens = Boolean(tokenTotals && tokenTotals.measuredCalls > 0);
  const measuredTotalTokens = tokenTotals
    ? tokenTotals.totalTokens || tokenTotals.promptTokens + tokenTotals.completionTokens
    : 0;
  const hasTokenCalls = Boolean(tokenUsage?.calls.length);

  if (!items.length && !Number.isFinite(total) && !hasTokenCalls) {
    return null;
  }

  return (
    <div className="fixed left-4 bottom-4 z-40">
      <div className="relative">
        <div
          className={`absolute left-0 bottom-full mb-2 w-64 rounded-2xl bg-bg-secondary/90 text-xs text-text-secondary shadow-lg shadow-black/10 border border-bg-secondary/60 backdrop-blur px-4 py-3 space-y-2 origin-bottom-left transition-all duration-200 ease-out ${
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
          {hasTokenCalls && (
            <>
              <div className="border-t border-text-secondary/10 pt-2" />
              <div className="flex items-center justify-between">
                <span>{t('timing.tokensTotal')}</span>
                <span className="text-text-primary font-medium">
                  {hasMeasuredTokens ? formatTokens(measuredTotalTokens) : t('timing.tokensUnmeasured')}
                </span>
              </div>
              {hasMeasuredTokens && (
                <>
                  <div className="flex items-center justify-between">
                    <span>{t('timing.tokensInput')}</span>
                    <span className="text-text-primary font-medium">{formatTokens(tokenTotals!.promptTokens)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('timing.tokensOutput')}</span>
                    <span className="text-text-primary font-medium">{formatTokens(tokenTotals!.completionTokens)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span>{t('timing.tokensCalls')}</span>
                <span className="text-text-primary font-medium">
                  {tokenTotals?.measuredCalls || 0}/{tokenUsage!.calls.length}
                </span>
              </div>
              {!!tokenTotals?.unmeasuredCalls && (
                <div className="text-[10px] leading-relaxed text-text-secondary/70">
                  {t('timing.tokensPartial', { count: tokenTotals.unmeasuredCalls })}
                </div>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-bg-secondary/80 text-xs text-text-secondary/90 shadow-lg shadow-black/10 backdrop-blur border border-bg-secondary/60 hover:text-text-primary hover:bg-bg-secondary transition-colors"
        >
          <span className="text-[11px] tracking-wide">{t('timing.title')}</span>
          <span className="text-text-primary font-medium">{formatDuration(total)}</span>
          {hasTokenCalls && (
            <span className="text-text-primary/80 font-medium">
              · {hasMeasuredTokens ? `${formatTokens(measuredTotalTokens)} tok` : t('timing.tokensUnmeasured')}
            </span>
          )}
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
