import type OpenAI from 'openai'
import type { StudioAssistantMessage, StudioMessageStore } from '../domain/types'
import { createLogger } from '../../utils/logger'

const logger = createLogger('StudioProviderMessage')

type ChatCompletionMessageWithReasoning = OpenAI.Chat.Completions.ChatCompletionMessage & {
  reasoning_content?: unknown
}

type AssistantMessageParamWithReasoning = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
  reasoning_content?: unknown
}

/**
 * 存储的助手工具调用接口
 */
export interface StudioStoredAssistantToolCall {
  id?: string
  type?: 'function'
  function?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * 存储的助手消息载荷接口
 */
export interface StudioStoredAssistantPayload {
  content?: string | Array<Record<string, unknown>> | null
  reasoning_content?: unknown
  tool_calls?: StudioStoredAssistantToolCall[]
}

/**
 * 将 OpenAI 响应消息转换为对话格式的助手消息
 * @param message - OpenAI 聊天完成消息
 * @param assistantText - 助手文本
 * @param toolCalls - 工具调用数组
 * @returns 助手消息参数
 */
export function toAssistantConversationMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
  assistantText: string,
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  const normalizedToolCalls = cloneStoredToolCalls(toolCalls)
  const providerMessage = message as ChatCompletionMessageWithReasoning | undefined
  const assistantMessage = {
    role: 'assistant',
    content: message?.content ?? (assistantText || null),
    reasoning_content: cloneStoredReasoningContent(providerMessage?.reasoning_content),
    tool_calls: normalizedToolCalls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
  }
  return assistantMessage as AssistantMessageParamWithReasoning
}

/**
 * 持久化提供者消息快照到存储
 * @param input - 包含消息存储、助手消息和提供者消息的输入对象
 */
export async function persistProviderMessageSnapshot(input: {
  messageStore: StudioMessageStore
  assistantMessage: StudioAssistantMessage
  providerMessage?: OpenAI.Chat.Completions.ChatCompletionMessage
}): Promise<void> {
  if (!input.providerMessage) {
    return
  }

  const metadata = {
    ...(input.assistantMessage.metadata ?? {}),
    providerMessage: buildStoredProviderMessagePayload(input.providerMessage)
  }

  input.assistantMessage.metadata = metadata
  await input.messageStore.updateAssistantMessage(input.assistantMessage.id, {
    metadata
  })
}

/**
 * 构建存储的提供者消息载荷
 * @param providerMessage - OpenAI 提供者消息
 * @returns 存储格式的载荷
 */
export function buildStoredProviderMessagePayload(
  providerMessage: OpenAI.Chat.Completions.ChatCompletionMessage
): StudioStoredAssistantPayload {
  const providerMessageWithReasoning = providerMessage as ChatCompletionMessageWithReasoning
  const toolCalls = cloneStoredToolCalls(providerMessage.tool_calls)
  const reasoningContent = cloneStoredReasoningContent(providerMessageWithReasoning.reasoning_content)
  logger.debug('buildStoredProviderMessagePayload', {
    role: providerMessage.role,
    contentType: typeof providerMessage.content,
    contentIsArray: Array.isArray(providerMessage.content),
    hasReasoningContent: Boolean(reasoningContent),
    reasoningContentType: typeof providerMessageWithReasoning.reasoning_content,
    reasoningContentIsArray: Array.isArray(providerMessageWithReasoning.reasoning_content),
    reasoningContentLength: Array.isArray(providerMessageWithReasoning.reasoning_content) ? providerMessageWithReasoning.reasoning_content.length : undefined,
    hasToolCalls: Boolean(providerMessage.tool_calls?.length),
    toolCallsLength: providerMessage.tool_calls?.length,
  })
  if (reasoningContent && process.env.DEBUG_REASONING_CHAIN === 'true') {
    logger.info('[reasoning_chain]', JSON.stringify(reasoningContent, null, 2))
  }
  return {
    content: providerMessage.content ?? null,
    reasoning_content: reasoningContent,
    tool_calls: toolCalls
  }
}

function cloneStoredReasoningContent(reasoningContent: unknown): unknown {
  if (reasoningContent === undefined) {
    return undefined
  }

  if (Array.isArray(reasoningContent) && reasoningContent.length === 0) {
    return undefined
  }

  return cloneUnknownValue(reasoningContent)
}

/**
 * 规范化存储的工具调用数组
 * @param toolCalls - 工具调用数组
 * @returns 规范化后的工具调用数组
 */
function cloneStoredToolCalls(
  toolCalls: readonly OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
): StudioStoredAssistantToolCall[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined
  }
  return toolCalls.map((toolCall) => cloneUnknownValue(toolCall) as StudioStoredAssistantToolCall)
}

/**
 * 总结对话尾部用于调试
 * @param conversation - 对话消息数组
 * @returns 尾部消息的摘要数组
 */
export function summarizeConversationTailForDebug(
  conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Array<Record<string, unknown>> {
  const tail = conversation.slice(-4)
  return tail.map((message, index) => ({
    indexFromTail: index,
    ...summarizeConversationMessageForDebug(message)
  }))
}

/**
 * 总结单条消息用于调试
 * @param message - 对话消息
 * @returns 消息摘要
 */
export function summarizeConversationMessageForDebug(
  message: OpenAI.Chat.Completions.ChatCompletionMessageParam | undefined
): Record<string, unknown> {
  if (!message) {
    return { missing: true }
  }

  const withToolCalls = message as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
    tool_call_id?: string
  }

  return {
    role: message.role,
    content: summarizeContentForDebug(withToolCalls.content),
    toolCallId: typeof withToolCalls.tool_call_id === 'string' ? withToolCalls.tool_call_id : undefined,
    toolCalls: Array.isArray(withToolCalls.tool_calls)
      ? withToolCalls.tool_calls.map(summarizeToolCallForDebug)
      : undefined,
  }
}

/**
 * 总结助手消息用于调试
 * @param message - 助手消息
 * @returns 消息摘要
 */
export function summarizeAssistantMessageForDebug(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined
): Record<string, unknown> {
  if (!message) {
    return { missing: true }
  }

  return {
    role: message.role,
    content: summarizeContentForDebug(message.content),
    reasoningContent: summarizeContentForDebug((message as { reasoning_content?: unknown }).reasoning_content),
    toolCalls: Array.isArray(message.tool_calls)
      ? message.tool_calls.map(summarizeToolCallForDebug)
      : undefined,
  }
}

/**
 * 总结内容用于调试
 * @param content - 内容对象
 * @returns 内容摘要
 */
function summarizeContentForDebug(content: unknown): Record<string, unknown> {
  if (content === null) {
    return { kind: 'null' }
  }

  if (typeof content === 'string') {
    return {
      kind: 'string',
      length: content.length,
      preview: content.length > 120 ? `${content.slice(0, 117)}...` : content,
    }
  }

  if (Array.isArray(content)) {
    return {
      kind: 'array',
      blockCount: content.length,
      blocks: content.map((block, index) => summarizeContentBlockForDebug(block, index)),
    }
  }

  return {
    kind: typeof content,
    keys: readObjectKeys(content),
  }
}

/**
 * 总结内容块用于调试
 * @param block - 内容块
 * @param index - 索引
 * @returns 内容块摘要
 */
function summarizeContentBlockForDebug(block: unknown, index: number): Record<string, unknown> {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return {
      index,
      kind: typeof block,
    }
  }

  const typed = block as Record<string, unknown>
  return {
    index,
    type: typeof typed.type === 'string' ? typed.type : undefined,
    keys: Object.keys(typed),
    hasThoughtSignature: 'thought_signature' in typed,
    thoughtSignatureType: typeof typed.thought_signature,
    id: typeof typed.id === 'string' ? typed.id : undefined,
    name: typeof typed.name === 'string' ? typed.name : undefined,
    callId: typeof typed.call_id === 'string' ? typed.call_id : undefined,
  }
}

/**
 * 总结工具调用用于调试
 * @param toolCall - 工具调用对象
 * @returns 工具调用摘要
 */
function summarizeToolCallForDebug(toolCall: unknown): Record<string, unknown> {
  if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
    return {
      kind: typeof toolCall,
    }
  }

  const typed = toolCall as Record<string, unknown>
  const fn = typed.function && typeof typed.function === 'object' && !Array.isArray(typed.function)
    ? typed.function as Record<string, unknown>
    : undefined

  const rawArguments = typeof fn?.arguments === 'string' ? fn.arguments : undefined

  return {
    id: typeof typed.id === 'string' ? typed.id : undefined,
    type: typeof typed.type === 'string' ? typed.type : undefined,
    keys: Object.keys(typed),
    hasThoughtSignature: 'thought_signature' in typed,
    thoughtSignatureType: typeof typed.thought_signature,
    functionName: typeof fn?.name === 'string' ? fn.name : undefined,
    functionKeys: fn ? Object.keys(fn) : [],
    functionHasThoughtSignature: fn ? 'thought_signature' in fn : false,
    functionThoughtSignatureType: fn ? typeof fn.thought_signature : 'undefined',
    argumentsLength: rawArguments?.length ?? 0,
    argumentsPreview: rawArguments && rawArguments.length > 160 ? `${rawArguments.slice(0, 157)}...` : rawArguments,
  }
}

/**
 * 读取对象的键名
 * @param value - 对象值
 * @returns 键名数组
 */
function readObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }
  return Object.keys(value as Record<string, unknown>)
}

function cloneUnknownValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneUnknownValue(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [key, cloneUnknownValue(entryValue)])
    ) as T
  }

  return value
}




