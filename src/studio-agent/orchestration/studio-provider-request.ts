import type OpenAI from 'openai'
import { logPlotStudioTiming, readElapsedMs } from '../observability/plot-studio-timing'

const DEFAULT_PROVIDER_TIMEOUT_MS = parsePositiveInteger(
  process.env.STUDIO_PROVIDER_REQUEST_TIMEOUT_MS,
  120000,
)

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
  studioKind?: string
  runCreatedAt?: string
  requestMessageCount?: number
  requestMessageCharsApprox?: number
  requestToolSchemaCharsApprox?: number
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
    })

    logPlotStudioTiming(input.studioKind, 'provider.completed', {
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
    })

    return completion
  } catch (error) {
    logPlotStudioTiming(input.studioKind, 'provider.failed', {
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
    }, 'warn')
    throw error
  }
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
