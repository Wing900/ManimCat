import OpenAI from 'openai'
import { createLogger } from '../utils/logger'
import { recordJobTokenUsage } from './job-log-context'

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
}

const logger = createLogger('OpenAIStream')
const INCLUDE_STREAM_USAGE = process.env.OPENAI_STREAM_INCLUDE_USAGE === 'true'
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

      const delta = chunk.choices?.[0]?.delta?.content
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

    return {
      content: content.trim(),
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
