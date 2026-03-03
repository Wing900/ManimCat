import { AsyncLocalStorage } from 'async_hooks'

export interface TokenUsageEntry {
  label: string
  model?: string
  mode: 'stream' | 'stream-partial' | 'non-stream'
  maxTokens?: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

interface JobLogContext {
  jobId: string
  outputMode: string
  attempts: number
  tokenUsages: TokenUsageEntry[]
}

const storage = new AsyncLocalStorage<JobLogContext>()

function normalizeTokenValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }
  return Math.floor(parsed)
}

export function runWithJobLogContext<T>(
  params: { jobId: string; outputMode: string; attempts?: number },
  run: () => Promise<T>
): Promise<T> {
  const context: JobLogContext = {
    jobId: params.jobId,
    outputMode: params.outputMode,
    attempts: params.attempts || 1,
    tokenUsages: []
  }
  return storage.run(context, run)
}

export function recordJobTokenUsage(entry: {
  label: string
  model?: unknown
  mode: 'stream' | 'stream-partial' | 'non-stream'
  maxTokens?: unknown
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
}): void {
  const context = storage.getStore()
  if (!context) {
    return
  }

  context.tokenUsages.push({
    label: entry.label,
    model: typeof entry.model === 'string' ? entry.model : undefined,
    mode: entry.mode,
    maxTokens: normalizeTokenValue(entry.maxTokens) ?? undefined,
    promptTokens: normalizeTokenValue(entry.usage?.prompt_tokens),
    completionTokens: normalizeTokenValue(entry.usage?.completion_tokens),
    totalTokens: normalizeTokenValue(entry.usage?.total_tokens)
  })
}

export function getCurrentJobLogSummary(): {
  jobId: string
  outputMode: string
  attempts: number
  calls: TokenUsageEntry[]
  totals: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    measuredCalls: number
    unmeasuredCalls: number
  }
} | null {
  const context = storage.getStore()
  if (!context) {
    return null
  }

  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let measuredCalls = 0

  for (const call of context.tokenUsages) {
    const hasMeasuredUsage =
      call.promptTokens !== null || call.completionTokens !== null || call.totalTokens !== null

    if (!hasMeasuredUsage) {
      continue
    }

    measuredCalls += 1
    promptTokens += call.promptTokens || 0
    completionTokens += call.completionTokens || 0
    totalTokens += call.totalTokens || 0
  }

  return {
    jobId: context.jobId,
    outputMode: context.outputMode,
    attempts: context.attempts,
    calls: [...context.tokenUsages],
    totals: {
      promptTokens,
      completionTokens,
      totalTokens,
      measuredCalls,
      unmeasuredCalls: Math.max(context.tokenUsages.length - measuredCalls, 0)
    }
  }
}

