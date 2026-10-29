import type OpenAI from 'openai'
import type { CustomApiConfig } from '../../types'

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
const EFFORTS = new Set<string>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const clientEfforts = new WeakMap<OpenAI, NonNullable<CustomApiConfig['reasoningEffort']>>()

export function configureClientReasoning(client: OpenAI, effort: CustomApiConfig['reasoningEffort']): void {
  if (effort) clientEfforts.set(client, effort)
}

export function isReasoningEffort(value: string): value is NonNullable<CustomApiConfig['reasoningEffort']> {
  return value === 'provider-default' || EFFORTS.has(value)
}

/** Every stage inherits the global total budget unless its own limit is explicitly configured. */
export function readMaxCompletionTokens(stage?: string): number {
  const raw = (stage ? process.env[`${stage}_MAX_TOKENS`]?.trim() : undefined)
    || process.env.AI_MAX_TOKENS?.trim() || '64000'
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${stage ? `${stage}_MAX_TOKENS / ` : ''}AI_MAX_TOKENS must be a positive integer`)
  }
  return value
}

/** Total generation budget includes reasoning AND answer tokens. No synthetic thinking budget. */
export function buildCompletionParams(maxTokens: number, stage?: string, client?: OpenAI): Pick<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'max_completion_tokens' | 'reasoning_effort'
> {
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('AI max tokens must be a positive integer')
  }
  const preference = client ? clientEfforts.get(client) : undefined
  const effort = preference === 'provider-default' ? undefined : preference ?? readReasoningEffort(stage)
  return {
    max_completion_tokens: maxTokens,
    // Compatible providers can support newer effort names than the installed SDK's union.
    ...(effort ? { reasoning_effort: effort as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming['reasoning_effort'] } : {}),
  }
}

export function readReasoningEffort(stage?: string): ReasoningEffort | undefined {
  const raw = (stage ? process.env[`${stage}_REASONING_EFFORT`]?.trim() : undefined)
    || process.env.AI_REASONING_EFFORT?.trim() || 'high'
  // Explicit escape hatch for models/providers without reasoning controls.
  if (raw === 'provider-default') return undefined
  if (!EFFORTS.has(raw)) throw new Error(`Unsupported reasoning effort: ${raw}`)
  return raw as ReasoningEffort
}

export function readProviderTimeoutMs(): number {
  const raw = process.env.AI_PROVIDER_REQUEST_TIMEOUT_MS?.trim()
  if (!raw) return 600_000
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('AI_PROVIDER_REQUEST_TIMEOUT_MS must be a positive integer')
  }
  return value
}
