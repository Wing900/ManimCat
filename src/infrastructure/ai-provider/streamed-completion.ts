import OpenAI from 'openai'
import { readProviderTimeoutMs } from './completion-policy'
import { CompletionTokenLimitError } from './completion-errors'

export function isUnsupportedStreamUsageOption(error: unknown): boolean {
  return error instanceof OpenAI.APIError
    && [400, 422].includes(error.status ?? 0)
    && /stream_options|include_usage/i.test(error.message)
}

/** Collect tool-call fragments with the SDK while retaining provider reasoning extensions. */
export async function collectStreamedCompletion(
  client: OpenAI,
  request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const timeoutMs = options.timeoutMs ?? readProviderTimeoutMs()
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('AI completion exceeded total request deadline')), timeoutMs)
  const collect = async (includeUsage: boolean) => {
    const stream = client.beta.chat.completions.stream({
      ...request,
      stream: true,
      ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    }, { signal: controller.signal, timeout: timeoutMs, maxRetries: 0 })
    const reasoning = new Map<number, string>()
    stream.on('chunk', (chunk) => {
      for (const choice of chunk.choices) {
        const delta = choice.delta as { reasoning_content?: unknown }
        if (typeof delta.reasoning_content === 'string') {
          reasoning.set(choice.index, (reasoning.get(choice.index) ?? '') + delta.reasoning_content)
        }
      }
    })
    const completion = await stream.finalChatCompletion()
    if (completion.choices.some((choice) => choice.finish_reason === 'length')) {
      throw new CompletionTokenLimitError({
        model: request.model,
        maxTokens: request.max_completion_tokens ?? request.max_tokens ?? undefined,
        reasoningEffort: request.reasoning_effort,
      })
    }
    for (const choice of completion.choices) {
      const content = reasoning.get(choice.index)
      if (content) Object.assign(choice.message, { reasoning_content: content })
    }
    return completion
  }
  try {
    const includeUsage = process.env.OPENAI_STREAM_INCLUDE_USAGE !== 'false'
    try {
      return await collect(includeUsage)
    } catch (error) {
      if (!includeUsage || controller.signal.aborted || !isUnsupportedStreamUsageOption(error)) throw error
      return await collect(false)
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}
