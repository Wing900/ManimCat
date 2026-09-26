import { useI18n } from '../../i18n'
import type { StudioTokenUsage } from '../protocol/studio-agent-types'

/**
 * Compact token counts for the 360 px status column: exact digits for small values,
 * `k` / `M` units beyond that. No locale-dependent formatting is used, so the value is
 * stable between server rendering, tests and browsers.
 */
export function formatStudioTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }
  if (value < 10_000) {
    return String(Math.trunc(value))
  }
  if (value < 1_000_000) {
    return `${roundToTenth(value / 1_000)}k`
  }
  return `${roundToTenth(value / 1_000_000)}M`
}

function roundToTenth(value: number): string {
  return String(Math.round(value * 10) / 10)
}

export function StudioTokenUsageView({ usage }: { usage: StudioTokenUsage }) {
  const { t } = useI18n()
  const allUnmeasured = usage.measuredCalls === 0 && usage.unmeasuredCalls > 0

  return (
    <section className="mt-5 border-t border-black/5 pt-4 dark:border-white/10" data-testid="studio-token-usage">
      <div className="text-[10px] uppercase tracking-[0.3em] text-text-secondary/45">{t('studio.tokens.title')}</div>

      {allUnmeasured ? (
        <div className="mt-2 text-xs text-text-secondary/55" data-testid="studio-token-usage-unmeasured">
          {t('studio.tokens.unmeasured')}
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="text-lg font-medium text-text-primary/88" data-testid="studio-token-usage-total">
              {formatStudioTokenCount(usage.totalTokens)}
            </div>
            <div className="text-[11px] text-text-secondary/45">{t('studio.tokens.total')}</div>
          </div>
          <div className="mt-2 space-y-1">
            <TokenRow label={t('studio.tokens.input')} value={formatStudioTokenCount(usage.promptTokens)} testId="studio-token-usage-input" />
            <TokenRow label={t('studio.tokens.output')} value={formatStudioTokenCount(usage.completionTokens)} testId="studio-token-usage-output" />
          </div>
        </>
      )}

      <div className="mt-2 space-y-1">
        {usage.measuredCalls > 0 && (
          <TokenRow label={t('studio.tokens.measuredCalls')} value={String(usage.measuredCalls)} testId="studio-token-usage-measured-calls" />
        )}
        {usage.unmeasuredCalls > 0 && (
          <TokenRow label={t('studio.tokens.unmeasuredCalls')} value={String(usage.unmeasuredCalls)} testId="studio-token-usage-unmeasured-calls" />
        )}
      </div>
    </section>
  )
}

function TokenRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[11px] text-text-secondary/45">{label}</div>
      <div className="text-[11px] text-text-primary/70" data-testid={testId}>{value}</div>
    </div>
  )
}
