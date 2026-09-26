/**
 * Compact token counts for the 360 px status column: exact digits for small values,
 * `k` / `M` units beyond that. No locale-dependent formatting is used, so the value is
 * stable between server rendering, tests and browsers.
 *
 * Kept out of `StudioTokenUsageView.tsx` so that module only exports components
 * (`react-refresh/only-export-components`).
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
