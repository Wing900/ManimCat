/**
 * Conservative context budgeting for the Studio Tool Loop.
 *
 * Token counts are estimated from text, never from a provider tokenizer: ASCII is about four
 * characters per token, CJK is about one character per token, and everything else sits between.
 * A provider's reported `prompt_tokens` can calibrate the estimate for the rest of the Run.
 */

export interface StudioContextConfig {
  contextWindowTokens: number
  reserveTokens: number
  keepRecentTokens: number
  enabled: boolean
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000
const DEFAULT_RESERVE_TOKENS = 16_384
const DEFAULT_KEEP_RECENT_TOKENS = 20_000

export function readStudioContextConfig(env: NodeJS.ProcessEnv = process.env): StudioContextConfig {
  return {
    contextWindowTokens: readPositiveInteger(env.STUDIO_CONTEXT_WINDOW_TOKENS, DEFAULT_CONTEXT_WINDOW_TOKENS),
    reserveTokens: readPositiveInteger(env.STUDIO_CONTEXT_RESERVE_TOKENS, DEFAULT_RESERVE_TOKENS),
    keepRecentTokens: readPositiveInteger(env.STUDIO_CONTEXT_KEEP_RECENT_TOKENS, DEFAULT_KEEP_RECENT_TOKENS),
    enabled: env.STUDIO_CONTEXT_COMPACTION_ENABLED !== 'false' && env.STUDIO_CONTEXT_COMPACTION_ENABLED !== '0',
  }
}

/** Estimated tokens for one string; surrogate pairs count as one code point. */
export function estimateStudioTokenCount(text: string): number {
  let ascii = 0
  let cjk = 0
  let other = 0

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) {
      ascii += 1
    } else if (isCjkCodePoint(codePoint)) {
      cjk += 1
    } else {
      other += 1
    }
  }

  return Math.ceil(ascii / 4 + cjk + other / 2)
}

/** Estimated tokens for a provider message array or any JSON-compatible value. */
export function estimateStudioValueTokens(value: unknown): number {
  const serialized = JSON.stringify(value)
  return serialized ? estimateStudioTokenCount(serialized) : 0
}

export function estimateStudioMessagesTokens(messages: readonly unknown[]): number {
  return estimateStudioValueTokens(messages)
}

export function estimateStudioContextTokens(input: {
  systemPrompt: string
  messages: readonly unknown[]
  tools: readonly unknown[]
  /** Actual/estimated ratio from an earlier provider response; 1 when uncalibrated. */
  ratio?: number
}): number {
  const raw = estimateStudioTokenCount(input.systemPrompt)
    + estimateStudioMessagesTokens(input.messages)
    + estimateStudioValueTokens(input.tools)
  return Math.ceil(raw * (input.ratio && input.ratio > 0 ? input.ratio : 1))
}

/** The usable input budget: the window minus the output/reasoning reserve. */
export function readStudioContextLimit(config: StudioContextConfig): number {
  return Math.max(1, config.contextWindowTokens - config.reserveTokens)
}

export function shouldCompactStudioContext(input: {
  config: StudioContextConfig
  systemPrompt: string
  messages: readonly unknown[]
  tools: readonly unknown[]
  ratio?: number
}): boolean {
  if (!input.config.enabled) {
    return false
  }

  return estimateStudioContextTokens(input) > readStudioContextLimit(input.config)
}

/**
 * Ratchets the estimate toward observed provider usage. `estimatedTokens` must already include
 * `currentRatio` (it is what the provider was sent), so the observed correction is applied on top
 * of the current ratio instead of replacing it. A single bad observation cannot move the ratio
 * outside a 0.25x..4x band, and a missing `prompt_tokens` leaves the previous ratio alone.
 */
export function calibrateStudioTokenRatio(input: {
  estimatedTokens: number
  actualPromptTokens: number | undefined
  currentRatio?: number
}): number {
  const current = input.currentRatio && input.currentRatio > 0 ? input.currentRatio : 1
  if (!input.actualPromptTokens || input.actualPromptTokens <= 0 || input.estimatedTokens <= 0) {
    return current
  }

  const observed = input.actualPromptTokens / input.estimatedTokens
  return Math.min(4, Math.max(0.25, current * observed))
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe4f)
    || (codePoint >= 0xff00 && codePoint <= 0xffef)
  )
}
