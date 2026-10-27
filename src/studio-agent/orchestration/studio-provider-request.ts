import type OpenAI from 'openai'
import type { StudioKind } from '../domain/core-types'
import { getStudioTelemetry, readElapsedMs } from '../infrastructure/telemetry/studio-telemetry'

// 单次上游请求上限 5 分钟；自动重试时总等待可能更长
const DEFAULT_PROVIDER_TIMEOUT_MS = parsePositiveInteger(
  process.env.STUDIO_PROVIDER_REQUEST_TIMEOUT_MS,
  5 * 60 * 1000,
)

/**
 * 请求 OpenAI 聊天完成
 * @param input - 包含客户端、模型、消息、工具等配置对象
 * @returns 聊天完成响应
 */
export async function requestStudioChatCompletion(input: {
  client: OpenAI
  model: string
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
  toolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption
  sessionId: string
  runId: string
  step: number
  assistantMessageId: string
  studioKind: StudioKind
  runCreatedAt?: string
  requestMessageCount?: number
  requestMessageCharsApprox?: number
  requestToolSchemaCharsApprox?: number
  signal?: AbortSignal
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const startedAt = Date.now()

  try {
    const completion = await input.client.chat.completions.create({
      model: input.model,
      messages: input.messages,
      tools: input.tools,
      tool_choice: input.toolChoice,
    }, {
      timeout: DEFAULT_PROVIDER_TIMEOUT_MS,
      signal: input.signal,
    })

    getStudioTelemetry().event({ studioKind: input.studioKind, name: 'provider.completed', data: {
      sessionId: input.sessionId,
      runId: input.runId,
      step: input.step,
      durationMs: readElapsedMs(startedAt),
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
      finishReason: completion.choices[0]?.finish_reason ?? null,
      toolCallCount: completion.choices[0]?.message?.tool_calls?.length ?? 0,
      hasAssistantText: Boolean(completion.choices[0]?.message?.content),
      promptTokens: completion.usage?.prompt_tokens ?? null,
      completionTokens: completion.usage?.completion_tokens ?? null,
      totalTokens: completion.usage?.total_tokens ?? null,
      requestMessageCount: input.requestMessageCount ?? null,
      requestMessageCharsApprox: input.requestMessageCharsApprox ?? null,
      requestToolSchemaCharsApprox: input.requestToolSchemaCharsApprox ?? null,
      runElapsedMs: input.runCreatedAt ? readElapsedMs(new Date(input.runCreatedAt).getTime()) : null,
    } })

    return completion
  } catch (error) {
    getStudioTelemetry().event({ studioKind: input.studioKind, name: 'provider.failed', data: {
      sessionId: input.sessionId,
      runId: input.runId,
      step: input.step,
      durationMs: readElapsedMs(startedAt),
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
      requestMessageCount: input.requestMessageCount ?? null,
      requestMessageCharsApprox: input.requestMessageCharsApprox ?? null,
      requestToolSchemaCharsApprox: input.requestToolSchemaCharsApprox ?? null,
      runElapsedMs: input.runCreatedAt ? readElapsedMs(new Date(input.runCreatedAt).getTime()) : null,
    }, level: 'warn' })
    throw error
  }
}

/**
 * 解析正整数，如果无效则返回回退值
 * @param raw - 原始字符串
 * @param fallback - 回退值
 * @returns 解析后的正整数
 */
function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
