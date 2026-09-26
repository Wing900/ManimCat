import type { StudioTokenUsage } from '../domain/types'

/**
 * Pure, provider-neutral token accounting for one Studio run.
 *
 * No OpenAI client, store, event bus or UI dependency lives here: provider snake_case is
 * read structurally at this boundary only, and everything that leaves this module is a
 * finite, non-negative integer. Malformed input (NaN, Infinity, negatives, strings,
 * fractional values, arrays, null) is rejected rather than coerced.
 *
 * Both inputs of the accounting boundary are validated at runtime, because a JavaScript
 * caller (or an `as any` value) can hand in an object the type system never checked. A
 * malformed per-call contribution is downgraded to one unmeasured invocation with zero
 * token contribution; a malformed aggregate falls back to an empty one. Nothing here
 * throws, and the "one observed invocation" invariant always holds.
 */

/** Structural shape of a provider usage object; extra provider fields are ignored. */
export interface StudioProviderUsageLike {
  prompt_tokens?: unknown
  completion_tokens?: unknown
  total_tokens?: unknown
}

/** Normalized contribution of exactly one provider invocation. */
export interface StudioCallTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  measured: boolean
}

export function createEmptyStudioTokenUsage(): StudioTokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    measuredCalls: 0,
    unmeasuredCalls: 0
  }
}

/** One observed invocation whose response carried no usable counter. */
export function unmeasuredStudioCallTokenUsage(): StudioCallTokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, measured: false }
}

function readCounter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function safeAdd(left: number, right: number): number {
  const sum = left + right
  return Number.isSafeInteger(sum) ? sum : Number.MAX_SAFE_INTEGER
}

function readProviderField(usage: unknown, field: keyof StudioProviderUsageLike): unknown {
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) {
    return undefined
  }
  return (usage as Record<string, unknown>)[field]
}

/**
 * Reads one provider usage object into a per-call contribution. A call is measured when
 * at least one counter is usable; a present `total_tokens` wins over the derived
 * `prompt + completion` so the call total is never double counted.
 */
export function normalizeStudioModelUsage(providerUsage?: unknown): StudioCallTokenUsage {
  const promptTokens = readCounter(readProviderField(providerUsage, 'prompt_tokens'))
  const completionTokens = readCounter(readProviderField(providerUsage, 'completion_tokens'))
  const totalTokens = readCounter(readProviderField(providerUsage, 'total_tokens'))

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return unmeasuredStudioCallTokenUsage()
  }

  const prompt = promptTokens ?? 0
  const completion = completionTokens ?? 0
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: totalTokens ?? safeAdd(prompt, completion),
    measured: true
  }
}

/**
 * Defensive reader for a per-call contribution handed in by an untrusted caller. Only a
 * contribution that claims `measured: true` and carries three valid counters is accepted,
 * and the accepted value is copied. Anything else degrades to a single unmeasured
 * invocation with zero tokens: it can neither inject an invalid number nor erase a valid
 * aggregate already on the tracker.
 */
function readCallTokenUsage(value: unknown): StudioCallTokenUsage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return unmeasuredStudioCallTokenUsage()
  }

  const record = value as Record<string, unknown>
  const promptTokens = readCounter(record.promptTokens)
  const completionTokens = readCounter(record.completionTokens)
  const totalTokens = readCounter(record.totalTokens)

  if (
    record.measured !== true
    || promptTokens === undefined
    || completionTokens === undefined
    || totalTokens === undefined
  ) {
    return unmeasuredStudioCallTokenUsage()
  }

  return { promptTokens, completionTokens, totalTokens, measured: true }
}

/**
 * Defensive reader for untrusted input (stored JSON, legacy rows). Returns undefined when
 * any field is missing or malformed, so a partial blob can never look like real usage.
 */
export function readStudioTokenUsage(value: unknown): StudioTokenUsage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const promptTokens = readCounter(record.promptTokens)
  const completionTokens = readCounter(record.completionTokens)
  const totalTokens = readCounter(record.totalTokens)
  const measuredCalls = readCounter(record.measuredCalls)
  const unmeasuredCalls = readCounter(record.unmeasuredCalls)

  if (
    promptTokens === undefined
    || completionTokens === undefined
    || totalTokens === undefined
    || measuredCalls === undefined
    || unmeasuredCalls === undefined
  ) {
    return undefined
  }

  return { promptTokens, completionTokens, totalTokens, measuredCalls, unmeasuredCalls }
}

/**
 * Adds exactly one invocation to the cumulative run value. Both sides are re-validated
 * here, so a malformed contribution counts one unmeasured call, contributes zero tokens,
 * and leaves a valid aggregate intact; arithmetic stays overflow-safe.
 */
export function accumulateStudioTokenUsage(
  current: StudioTokenUsage | undefined,
  call: StudioCallTokenUsage
): StudioTokenUsage {
  const base = readStudioTokenUsage(current) ?? createEmptyStudioTokenUsage()
  const contribution = readCallTokenUsage(call)

  return {
    promptTokens: safeAdd(base.promptTokens, contribution.promptTokens),
    completionTokens: safeAdd(base.completionTokens, contribution.completionTokens),
    totalTokens: safeAdd(base.totalTokens, contribution.totalTokens),
    measuredCalls: safeAdd(base.measuredCalls, contribution.measured ? 1 : 0),
    unmeasuredCalls: safeAdd(base.unmeasuredCalls, contribution.measured ? 0 : 1)
  }
}
