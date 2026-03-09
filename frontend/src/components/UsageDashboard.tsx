import { useEffect, useMemo, useState } from 'react';
import { getUsageMetrics } from '../lib/api';
import type { UsageDailyPoint, UsageMetricsResponse } from '../types/api';
import { useI18n } from '../i18n';

interface UsageDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

const RANGE_OPTIONS = [7, 14, 30] as const;
const REFRESH_INTERVAL_MS = 30_000;

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '-';
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function formatDateLabel(date: string): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) {
    return date;
  }
  return `${month}/${day}`;
}

function getMaxDailyValue(daily: UsageDailyPoint[]): number {
  const maxValue = daily.reduce((max, item) => Math.max(max, item.submittedTotal), 0);
  return maxValue > 0 ? maxValue : 1;
}

export function UsageDashboard({ isOpen, onClose }: UsageDashboardProps) {
  const { locale, t } = useI18n();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(7);
  const [data, setData] = useState<UsageMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setTimeout(() => setIsVisible(true), 50);
      return;
    }

    setIsVisible(false);
    const timeout = setTimeout(() => setShouldRender(false), 250);
    return () => clearTimeout(timeout);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    const loadData = async () => {
      if (!active) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await getUsageMetrics(rangeDays, controller.signal);
        if (active) {
          setData(response);
        }
      } catch (err) {
        if (!active) {
          return;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err.message : t('usage.loadFailed'));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadData();
    const timer = window.setInterval(() => {
      void loadData();
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [isOpen, rangeDays, t]);

  const chartRows = useMemo(() => data?.daily ?? [], [data]);
  const maxDailyValue = useMemo(() => getMaxDailyValue(chartRows), [chartRows]);
  const latestTenRows = useMemo(() => [...chartRows].reverse().slice(0, 10), [chartRows]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-bg-primary transition-all duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="h-14 bg-bg-secondary/50 border-b border-bg-tertiary/30 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 text-text-secondary/70 hover:text-text-primary hover:bg-bg-tertiary/50 rounded-lg transition-colors"
            aria-label={t('usage.close')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-sm font-medium text-text-primary">{t('usage.title')}</p>
            <p className="text-[11px] text-text-secondary/60">{t('usage.refresh')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map((days) => (
            <button
              key={days}
              onClick={() => setRangeDays(days)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                rangeDays === days
                  ? 'bg-accent text-white'
                  : 'bg-bg-secondary/50 text-text-secondary/80 hover:text-text-primary'
              }`}
            >
              {t('common.days', { count: days })}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading && !data ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 animate-pulse">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="rounded-2xl bg-bg-secondary/40 h-24" />
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl bg-red-50/80 dark:bg-red-900/20 border border-red-200/50 dark:border-red-700/40 p-4 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {data ? (
          <div className="space-y-5 animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <MetricCard title={t('usage.metric.submitted')} value={formatNumber(data.totals.submittedTotal, locale)} hint={t('usage.metric.submittedHint', { count: data.rangeDays })} />
              <MetricCard title={t('usage.metric.completed')} value={formatNumber(data.totals.completedTotal, locale)} hint={t('usage.metric.completedHint')} />
              <MetricCard title={t('usage.metric.successRate')} value={formatPercent(data.totals.successRate)} hint={t('usage.metric.successRateHint')} />
              <MetricCard title={t('usage.metric.avgRender')} value={formatDuration(data.totals.avgRenderMs)} hint={t('usage.metric.avgRenderHint')} />
              <MetricCard title={t('usage.metric.failed')} value={formatNumber(data.totals.failedTotal, locale)} hint={t('usage.metric.failedHint', { count: formatNumber(data.totals.cancelledTotal, locale) })} />
              <MetricCard title={t('usage.metric.video')} value={formatNumber(data.totals.completedVideo, locale)} hint="outputMode=video" />
              <MetricCard title={t('usage.metric.image')} value={formatNumber(data.totals.completedImage, locale)} hint="outputMode=image" />
              <MetricCard title={t('usage.metric.queue')} value={formatNumber(data.queue.waiting + data.queue.delayed, locale)} hint={t('usage.metric.queueHint', { count: formatNumber(data.queue.active, locale) })} />
            </div>

            <div className="rounded-2xl bg-bg-secondary/25 border border-bg-tertiary/30 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-text-primary">{t('usage.chart.title')}</h3>
                <p className="text-xs text-text-secondary/70">{t('usage.chart.subtitle', { count: data.rangeDays })}</p>
              </div>

              <div className="h-52 sm:h-60 flex items-end gap-2 sm:gap-3 overflow-x-auto pb-2">
                {chartRows.map((item) => {
                  const submittedHeight = Math.max((item.submittedTotal / maxDailyValue) * 100, item.submittedTotal > 0 ? 8 : 0);
                  const completedHeight = Math.max((item.completedTotal / maxDailyValue) * 100, item.completedTotal > 0 ? 6 : 0);
                  return (
                    <div key={item.date} className="relative min-w-[40px] sm:min-w-[48px] flex-1 flex flex-col items-center gap-1.5 group">
                      <div className="w-full h-40 sm:h-48 rounded-xl bg-bg-tertiary/20 relative overflow-hidden border border-bg-tertiary/30">
                        <div
                          className="absolute left-[22%] bottom-0 w-[22%] rounded-t-md bg-text-tertiary/45 transition-all"
                          style={{ height: `${submittedHeight}%` }}
                        />
                        <div
                          className="absolute right-[22%] bottom-0 w-[22%] rounded-t-md bg-accent/85 transition-all"
                          style={{ height: `${completedHeight}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-secondary/70">{formatDateLabel(item.date)}</span>
                      <div className="absolute opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity -translate-y-20 bg-bg-secondary border border-bg-tertiary/40 text-[11px] text-text-secondary px-2 py-1 rounded-md shadow-md">
                        {t('usage.chart.tooltip', { submitted: item.submittedTotal, completed: item.completedTotal })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl bg-bg-secondary/25 border border-bg-tertiary/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-bg-tertiary/30 flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary">{t('usage.table.title')}</h3>
                <p className="text-xs text-text-secondary/60">{new Date(data.timestamp).toLocaleString(locale)}</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-text-secondary/70 text-xs bg-bg-secondary/30">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">{t('usage.table.date')}</th>
                      <th className="text-right px-4 py-2.5 font-medium">{t('usage.table.submitted')}</th>
                      <th className="text-right px-4 py-2.5 font-medium">{t('usage.table.completed')}</th>
                      <th className="text-right px-4 py-2.5 font-medium">{t('usage.table.failed')}</th>
                      <th className="text-right px-4 py-2.5 font-medium">{t('usage.table.successRate')}</th>
                      <th className="text-right px-4 py-2.5 font-medium">{t('usage.table.avgDuration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestTenRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-text-secondary/60 text-xs">
                          {t('usage.table.empty')}
                        </td>
                      </tr>
                    ) : (
                      latestTenRows.map((row) => (
                        <tr key={row.date} className="border-t border-bg-tertiary/20 hover:bg-bg-secondary/20 transition-colors">
                          <td className="px-4 py-2.5 text-text-primary">{row.date}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatNumber(row.submittedTotal, locale)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatNumber(row.completedTotal, locale)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatNumber(row.failedTotal, locale)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatPercent(row.successRate)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatDuration(row.avgRenderMs)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  hint: string;
}

function MetricCard({ title, value, hint }: MetricCardProps) {
  return (
    <div className="rounded-2xl bg-bg-secondary/25 border border-bg-tertiary/30 px-4 py-3.5">
      <p className="text-xs text-text-secondary/70">{title}</p>
      <p className="mt-2 text-2xl font-medium text-text-primary tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-text-secondary/55">{hint}</p>
    </div>
  );
}
