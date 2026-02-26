import { useEffect, useMemo, useState } from 'react';
import { getUsageMetrics } from '../lib/api';
import type { UsageDailyPoint, UsageMetricsResponse } from '../types/api';

interface UsageDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

const RANGE_OPTIONS = [7, 14, 30] as const;
const REFRESH_INTERVAL_MS = 30_000;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value));
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
        setError(err instanceof Error ? err.message : '加载统计数据失败');
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
  }, [isOpen, rangeDays]);

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
            aria-label="关闭用量面板"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-sm font-medium text-text-primary">用量面板</p>
            <p className="text-[11px] text-text-secondary/60">每 30 秒自动刷新</p>
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
              {days} 天
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
              <MetricCard title="提交任务" value={formatNumber(data.totals.submittedTotal)} hint={`${data.rangeDays} 天累计`} />
              <MetricCard title="成功任务" value={formatNumber(data.totals.completedTotal)} hint="渲染完成" />
              <MetricCard title="成功率" value={formatPercent(data.totals.successRate)} hint="completed / submitted" />
              <MetricCard title="平均渲染耗时" value={formatDuration(data.totals.avgRenderMs)} hint="仅统计成功任务" />
              <MetricCard title="失败任务" value={formatNumber(data.totals.failedTotal)} hint={`取消 ${formatNumber(data.totals.cancelledTotal)} 次`} />
              <MetricCard title="视频完成" value={formatNumber(data.totals.completedVideo)} hint="outputMode=video" />
              <MetricCard title="图片完成" value={formatNumber(data.totals.completedImage)} hint="outputMode=image" />
              <MetricCard title="队列积压" value={formatNumber(data.queue.waiting + data.queue.delayed)} hint={`处理中 ${formatNumber(data.queue.active)}`} />
            </div>

            <div className="rounded-2xl bg-bg-secondary/25 border border-bg-tertiary/30 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-text-primary">日趋势</h3>
                <p className="text-xs text-text-secondary/70">提交/成功（最近 {data.rangeDays} 天）</p>
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
                        提交 {item.submittedTotal} / 成功 {item.completedTotal}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl bg-bg-secondary/25 border border-bg-tertiary/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-bg-tertiary/30 flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary">最近 10 天</h3>
                <p className="text-xs text-text-secondary/60">{new Date(data.timestamp).toLocaleString()}</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-text-secondary/70 text-xs bg-bg-secondary/30">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">日期</th>
                      <th className="text-right px-4 py-2.5 font-medium">提交</th>
                      <th className="text-right px-4 py-2.5 font-medium">成功</th>
                      <th className="text-right px-4 py-2.5 font-medium">失败</th>
                      <th className="text-right px-4 py-2.5 font-medium">成功率</th>
                      <th className="text-right px-4 py-2.5 font-medium">平均耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestTenRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-text-secondary/60 text-xs">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      latestTenRows.map((row) => (
                        <tr key={row.date} className="border-t border-bg-tertiary/20 hover:bg-bg-secondary/20 transition-colors">
                          <td className="px-4 py-2.5 text-text-primary">{row.date}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatNumber(row.submittedTotal)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatNumber(row.completedTotal)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{formatNumber(row.failedTotal)}</td>
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
