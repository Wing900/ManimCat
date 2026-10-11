import OpenAI from 'openai'
import { createLogger } from '../shared/logging/logger'
import { recordJobTokenUsage } from '../rendering/job/job-log-context'

interface ChatCompletionTextOptions {
  fallbackToNonStream?: boolean
  allowPartialOnStreamError?: boolean
  usageLabel?: string
}

type ChatCompletionRequest = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'stream'>

export interface ChatCompletionTextResult {
  content: string
  mode: 'stream' | 'stream-partial' | 'non-stream'
  response?: OpenAI.Chat.Completions.ChatCompletion
  /** True when the stream produced only reasoning_content and no final content, so a non-stream
   * follow-up turn was issued to make the model emit its answer. */
  followupApplied?: boolean
}

const logger = createLogger('OpenAIStream')
const INCLUDE_STREAM_USAGE = process.env.OPENAI_STREAM_INCLUDE_USAGE !== 'false'
const STREAM_HEARTBEAT_MS = parseInt(process.env.OPENAI_STREAM_HEARTBEAT_MS || '15000', 10)
const STREAM_IDLE_TIMEOUT_MS = parseInt(process.env.OPENAI_STREAM_IDLE_TIMEOUT_MS || '240000', 10)
const STREAM_CONTENT_TIMEOUT_MS = parseInt(process.env.OPENAI_STREAM_CONTENT_TIMEOUT_MS || '240000', 10)

interface MessageStats {
  messageCount: number
  textChars: number
  imageParts: number
}

function getMessageStats(messages: unknown): MessageStats {
  if (!Array.isArray(messages)) {
    return { messageCount: 0, textChars: 0, imageParts: 0 }
  }

  let textChars = 0
  let imageParts = 0

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue
    }

    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') {
      textChars += content.length
      continue
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') {
          continue
        }
        const typedPart = part as { type?: unknown; text?: unknown }
        if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
          textChars += typedPart.text.length
        } else if (typedPart.type === 'image_url') {
          imageParts += 1
        }
      }
    }
  }

  return {
    messageCount: messages.length,
    textChars,
    imageParts
  }
}

function getErrorMeta(error: unknown): Record<string, unknown> {
  const meta: Record<string, unknown> = {}

  if (error instanceof OpenAI.APIError) {
    meta.errorName = error.name
    meta.status = error.status
    meta.code = error.code
    meta.type = error.type
    meta.errorMessage = error.message
    if (error.headers) {
      meta.cfRay =
        error.headers['cf-ray'] ||
        error.headers['CF-Ray'] ||
        error.headers['x-request-id'] ||
        error.headers['X-Request-ID']
    }
    return meta
  }

  if (error instanceof Error) {
    meta.errorName = error.name
    meta.errorMessage = error.message
    return meta
  }

  meta.errorMessage = String(error)
  return meta
}

function shouldRetryWithoutStreamUsageOption(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) {
    return false
  }

  const message = (error.message || '').toLowerCase()
  return (
    message.includes('stream_options') ||
    message.includes('include_usage') ||
    message.includes('unknown parameter') ||
    message.includes('unsupported')
  )
}

export async function createChatCompletionText(
  client: OpenAI,
  request: ChatCompletionRequest,
  options: ChatCompletionTextOptions = {}
): Promise<ChatCompletionTextResult> {
  const startedAt = Date.now()
  const stats = getMessageStats((request as { messages?: unknown }).messages)
  const model = String((request as { model?: unknown }).model || '')
  const effectiveFallback = options.fallbackToNonStream ?? false
  const allowPartialOnStreamError = options.allowPartialOnStreamError ?? true

  logger.info('OpenAI chat request started', {
    model,
    requestType: 'chat.completions',
    stream: true,
    fallbackEnabled: effectiveFallback,
    ...stats,
    maxTokens: (request as { max_completion_tokens?: unknown }).max_completion_tokens ?? (request as { max_tokens?: unknown }).max_tokens
  })

  let receivedContent = false
  let chunkCount = 0
  let firstChunkAt: number | null = null
  let content = ''
  let reasoningContent = ''
  let streamUsage:
    | {
        prompt_tokens?: unknown
        completion_tokens?: unknown
        total_tokens?: unknown
      }
    | undefined
  let lastChunkAt = startedAt
  let heartbeatTimer: NodeJS.Timeout | null = null
  let idleTimer: NodeJS.Timeout | null = null
  let contentTimer: NodeJS.Timeout | null = null

  try {
    let usageTrackingEnabled = INCLUDE_STREAM_USAGE
    const createStream = async (includeUsage: boolean) => {
      const streamRequest: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        ...request,
        stream: true
      }
      if (includeUsage) {
        ;(streamRequest as { stream_options?: { include_usage: boolean } }).stream_options = {
          include_usage: true
        }
      }
      return client.chat.completions.create(streamRequest)
    }

    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    try {
      stream = await createStream(usageTrackingEnabled)
    } catch (error) {
      if (usageTrackingEnabled && shouldRetryWithoutStreamUsageOption(error)) {
        logger.warn('OpenAI stream usage option unsupported, retrying without usage tracking', {
          model,
          ...getErrorMeta(error)
        })
        usageTrackingEnabled = false
        stream = await createStream(false)
      } else {
        throw error
      }
    }

    const streamController = (stream as unknown as { controller?: { abort?: () => void } }).controller
    const abortStream = () => {
      if (streamController && typeof streamController.abort === 'function') {
        streamController.abort()
      }
    }

    if (Number.isFinite(STREAM_HEARTBEAT_MS) && STREAM_HEARTBEAT_MS > 0) {
      heartbeatTimer = setInterval(() => {
        logger.debug('OpenAI stream heartbeat', {
          model,
          chunkCount,
          contentLength: content.length,
          elapsedMs: Date.now() - startedAt,
          sinceLastChunkMs: Date.now() - lastChunkAt
        })
      }, STREAM_HEARTBEAT_MS)
    }

    if (Number.isFinite(STREAM_IDLE_TIMEOUT_MS) && STREAM_IDLE_TIMEOUT_MS > 0) {
      const checkEveryMs = Math.min(5000, Math.max(1000, Math.floor(STREAM_IDLE_TIMEOUT_MS / 4)))
      idleTimer = setInterval(() => {
        const sinceLastChunkMs = Date.now() - lastChunkAt
        if (sinceLastChunkMs <= STREAM_IDLE_TIMEOUT_MS) {
          return
        }

        logger.warn('OpenAI stream idle timeout, aborting stream', {
          model,
          idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
          sinceLastChunkMs,
          chunkCount,
          contentLength: content.length
        })
        try {
          abortStream()
        } catch (error) {
          logger.warn('Failed to abort OpenAI stream after idle timeout', { model, error: String(error) })
        }
      }, checkEveryMs)
    }

    if (Number.isFinite(STREAM_CONTENT_TIMEOUT_MS) && STREAM_CONTENT_TIMEOUT_MS > 0) {
      contentTimer = setTimeout(() => {
        if (receivedContent) return
        logger.warn('OpenAI stream produced no content before deadline, aborting stream', {
          model,
          contentTimeoutMs: STREAM_CONTENT_TIMEOUT_MS,
          chunkCount,
          elapsedMs: Date.now() - startedAt,
        })
        try {
          abortStream()
        } catch (error) {
          logger.warn('Failed to abort content-silent OpenAI stream', { model, error: String(error) })
        }
      }, STREAM_CONTENT_TIMEOUT_MS)
    }

    for await (const chunk of stream) {
      chunkCount += 1
      lastChunkAt = Date.now()

      const usage = (chunk as { usage?: typeof streamUsage }).usage
      if (usage && typeof usage === 'object') {
        streamUsage = usage
      }

      const deltaChoice = chunk.choices?.[0]
      const delta = deltaChoice?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        if (firstChunkAt === null) {
          firstChunkAt = Date.now()
          logger.info('OpenAI stream received first chunk', {
            model,
            firstChunkMs: firstChunkAt - startedAt
          })
        }
        content += delta
        receivedContent = true
      }
      // Thinking models (DeepSeek-style) stream the chain-of-thought under `reasoning_content`
      // separately from the final answer. Capture it so we can detect the case where the model
      // burned its whole token budget on reasoning and never emitted final content.
      const reasoningDelta = (deltaChoice?.delta as { reasoning_content?: unknown } | undefined)?.reasoning_content
      if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
        reasoningContent += reasoningDelta
      }
    }

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (idleTimer) {
      clearInterval(idleTimer)
      idleTimer = null
    }
    if (contentTimer) {
      clearTimeout(contentTimer)
      contentTimer = null
    }

    logger.info('OpenAI chat stream completed', {
      model,
      mode: 'stream',
      usageTrackingEnabled,
      elapsedMs: Date.now() - startedAt,
      firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
      chunkCount,
      contentLength: content.length
    })
    recordJobTokenUsage({
      label: options.usageLabel || 'chat-completion',
      model,
      mode: 'stream',
      maxTokens: (request as { max_completion_tokens?: unknown }).max_completion_tokens ?? (request as { max_tokens?: unknown }).max_tokens,
      usage: streamUsage
    })

    const trimmedContent = content.trim()
    const trimmedReasoning = reasoningContent.trim()
    if (trimmedContent.length === 0 && trimmedReasoning.length > 0) {
      logger.warn('OpenAI stream produced only reasoning content, issuing non-stream follow-up', {
        model,
        reasoningLength: trimmedReasoning.length,
        chunkCount,
        elapsedMs: Date.now() - startedAt
      })
      const followupContent = await issueReasoningFollowup(client, request, trimmedReasoning, options.usageLabel)
      if (followupContent) {
        return {
          content: followupContent,
          mode: 'non-stream',
          followupApplied: true
        }
      }
    }

    return {
      content: trimmedContent,
      mode: 'stream'
    }
  } catch (error) {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (idleTimer) {
      clearInterval(idleTimer)
      idleTimer = null
    }
    if (contentTimer) {
      clearTimeout(contentTimer)
      contentTimer = null
    }

    logger.warn('OpenAI chat stream failed', {
      model,
      elapsedMs: Date.now() - startedAt,
      firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
      chunkCount,
      receivedContent,
      partialContentLength: content.trim().length,
      willFallback: effectiveFallback && !receivedContent,
      ...getErrorMeta(error)
    })

    if (allowPartialOnStreamError && receivedContent) {
      const partial = content.trim()
      if (partial.length > 0) {
        logger.warn('OpenAI chat returning partial streamed content after stream error', {
          model,
          mode: 'stream-partial',
          contentLength: partial.length
        })
        recordJobTokenUsage({
          label: options.usageLabel || 'chat-completion',
          model,
          mode: 'stream-partial',
          maxTokens: (request as { max_completion_tokens?: unknown }).max_completion_tokens ?? (request as { max_tokens?: unknown }).max_tokens,
          usage: streamUsage
        })
        return {
          content: partial,
          mode: 'stream-partial'
        }
      }
    }

    if (effectiveFallback && !receivedContent) {
      logger.warn('OpenAI chat falling back to non-stream request', { model })
      const response = await client.chat.completions.create({
        ...request,
        stream: false
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)

      const fallbackContent = response.choices?.[0]?.message?.content
      const normalized = typeof fallbackContent === 'string' ? fallbackContent : ''

      recordJobTokenUsage({
        label: options.usageLabel || 'chat-completion',
        model,
        mode: 'non-stream',
        maxTokens: (request as { max_completion_tokens?: unknown }).max_completion_tokens ?? (request as { max_tokens?: unknown }).max_tokens,
        usage: (response as unknown as { usage?: typeof streamUsage }).usage
      })

      return {
        content: normalized.trim(),
        mode: 'non-stream',
        response
      }
    }

    recordJobTokenUsage({
      label: options.usageLabel || 'chat-completion',
      model,
      mode: 'stream',
      maxTokens: (request as { max_completion_tokens?: unknown }).max_completion_tokens ?? (request as { max_tokens?: unknown }).max_tokens,
      usage: streamUsage
    })

    throw error
  }
}

const FOLLOWUP_USER_PROMPT =
  '请基于以上思考，直接输出最终结果。不要重复推理过程，只给出最终答案。'
const FOLLOWUP_USER_PROMPT_FALLBACK =
  '上一次请求你只输出了推理过程而没有给出最终结果。请直接输出最终结果，不要再重复推理。'

function isUnsupportedReasoningParamError(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) {
    return false
  }
  const message = `${error.name} ${error.message || ''}`.toLowerCase()
  return (
    message.includes('reasoning_content') ||
    message.includes('unknown parameter') ||
    message.includes('unsupported') ||
    message.includes('unexpected parameter')
  )
}

/**
 * When a thinking model spends its whole token budget on `reasoning_content` and emits no final
 * answer, send one non-stream follow-up turn that asks the model to emit the answer directly.
 *
 * Strategy B: hand the prior reasoning back to the model as an assistant turn carrying
 * `reasoning_content` (the DeepSeek multi-turn convention), then a user turn asking for the final
 * answer. If the upstream provider rejects the `reasoning_content` input field, fall back to
 * Strategy A: a plain user turn that just asks for the final result without the prior reasoning.
 *
 * Returns the trimmed final content, or `null` if the follow-up also produced nothing usable (the
 * caller will then surface the original empty content so upstream retry/error handling applies).
 */
async function issueReasoningFollowup(
  client: OpenAI,
  request: ChatCompletionRequest,
  reasoningContent: string,
  usageLabel?: string
): Promise<string | null> {
  const baseMessages = ((request as { messages?: unknown }).messages ?? []) as unknown[]
  const maxTokens = (request as { max_completion_tokens?: unknown }).max_completion_tokens ??
    (request as { max_tokens?: unknown }).max_tokens
  const model = String((request as { model?: unknown }).model || '')
  const label = `${usageLabel || 'chat-completion'}-followup`

  const recordFollowupUsage = (usage: unknown): void => {
    recordJobTokenUsage({
      label,
      model,
      mode: 'non-stream',
      maxTokens,
      usage: usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } | undefined
    })
  }

  const createNonStream = (messages: unknown[]) =>
    client.chat.completions.create({
      ...request,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: false
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)

  // Strategy B: replay reasoning_content so the model can continue from its own chain-of-thought.
  try {
    const response = await createNonStream([
      ...baseMessages,
      {
        role: 'assistant',
        content: '',
        reasoning_content: reasoningContent
      },
      {
        role: 'user',
        content: FOLLOWUP_USER_PROMPT
      }
    ])
    const rawContent = response.choices?.[0]?.message?.content
    const normalized = typeof rawContent === 'string' ? rawContent.trim() : ''
    recordFollowupUsage((response as unknown as { usage?: unknown }).usage)
    if (normalized.length > 0) {
      logger.info('OpenAI reasoning follow-up (strategy B) produced final content', {
        model,
        contentLength: normalized.length
      })
      return normalized
    }
  } catch (error) {
    if (!isUnsupportedReasoningParamError(error)) {
      logger.warn('OpenAI reasoning follow-up (strategy B) failed with non-param error', {
        model,
        ...getErrorMeta(error)
      })
      throw error
    }
    logger.warn('OpenAI reasoning follow-up (strategy B) rejected reasoning_content param, falling back to strategy A', {
      model,
      ...getErrorMeta(error)
    })
  }

  // Strategy A: ask for the final result without replaying reasoning (provider-agnostic).
  const response = await createNonStream([
    ...baseMessages,
    {
      role: 'user',
      content: FOLLOWUP_USER_PROMPT_FALLBACK
    }
  ])
  const rawContent = response.choices?.[0]?.message?.content
  const normalized = typeof rawContent === 'string' ? rawContent.trim() : ''
  recordFollowupUsage((response as unknown as { usage?: unknown }).usage)
  if (normalized.length > 0) {
    logger.info('OpenAI reasoning follow-up (strategy A) produced final content', {
      model,
      contentLength: normalized.length
    })
    return normalized
  }

  logger.warn('OpenAI reasoning follow-up produced no final content', { model })
  return null
}
