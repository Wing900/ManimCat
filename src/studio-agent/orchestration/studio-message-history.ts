import type OpenAI from 'openai'
import type { ReferenceImage, VisionImageDetail } from '../../types'
import type { StudioAssistantMessage, StudioMessage, StudioToolPart } from '../domain/types'
import { createLogger } from '../../utils/logger'
import {
  type StudioStoredAssistantPayload,
  type StudioStoredAssistantToolCall,
} from './studio-provider-message'

const logger = createLogger('StudioMessageHistory')

const REFERENCE_IMAGES_START = '[STUDIO_REFERENCE_IMAGES]'
const REFERENCE_IMAGES_END = '[/STUDIO_REFERENCE_IMAGES]'

type AssistantMessageParamWithReasoning = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
  reasoning_content?: unknown
}

/**
 * 构建 Studio 对话消息数组，用于发送给 OpenAI API
 * @param input - 包含 Studio 消息数组的输入对象
 * @returns OpenAI 聊天完成 API 所需格式的消息数组
 */
export function buildStudioConversationMessages(input: {
  messages: StudioMessage[]
}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return input.messages.flatMap(toConversationMessages)
}

/**
 * 将单条 Studio 消息转换为 OpenAI 对话消息格式
 * @param message - Studio 消息对象
 * @returns OpenAI 格式的消息数组
 */
function toConversationMessages(message: StudioMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (message.role === 'user') {
    return [{ role: 'user', content: buildUserMessageContent(message.text) }]
  }

  if (message.role !== 'assistant') {
    return []
  }

  const raw = readStoredAssistantPayload(message)
  const toolMessages = buildToolMessages(message)
  if (raw) {
    const normalizedReasoning = cloneStoredReasoningContent(raw.reasoning_content)
    const assistantMessage = {
      role: 'assistant',
      content: raw.content as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam['content'],
      reasoning_content: normalizedReasoning,
      tool_calls: raw.tool_calls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
    }
    logger.debug('toConversationMessages with stored payload', {
      messageId: message.id,
      role: message.role,
      hasContent: Boolean(raw.content),
      contentType: typeof raw.content,
      hasReasoningContent: Boolean(normalizedReasoning),
      reasoningLength: typeof normalizedReasoning === 'string'
        ? normalizedReasoning.length
        : Array.isArray(normalizedReasoning)
          ? normalizedReasoning.length
          : undefined,
      hasToolCalls: Boolean(raw.tool_calls?.length),
      toolCallsLength: raw.tool_calls?.length,
    })

    const conversationMessages = [
      assistantMessage as AssistantMessageParamWithReasoning,
      ...toolMessages
    ]

    return conversationMessages
  }

  const content = flattenAssistantMessage(message)
  if (!content) {
    return toolMessages
  }

  return [
    { role: 'assistant', content },
    ...toolMessages
  ]
}

/**
 * 构建工具调用结果消息数组
 * @param message -助手消息对象
 * @returns 工具调用结果消息数组
 */
function buildToolMessages(message: StudioAssistantMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return message.parts
    .filter((part): part is StudioToolPart => part.type === 'tool')
    .flatMap((part) => {
      if (part.state.status === 'completed') {
        return [{ role: 'tool', tool_call_id: part.callId, content: part.state.output || '(empty tool result)' }]
      }

      if (part.state.status === 'error') {
        return [{ role: 'tool', tool_call_id: part.callId, content: `Tool execution failed: ${part.state.error}` }]
      }

      return []
    })
}

/**
 * 读取存储的助手消息元数据
 * @param message -助手消息对象
 * @returns 存储的提供者消息内容，如果不存在则返回 null
 */
function readStoredAssistantPayload(message: StudioAssistantMessage): {
  content: string | Array<Record<string, unknown>> | null
  reasoning_content?: unknown
  tool_calls?: StudioStoredAssistantToolCall[]
} | null {
  const candidate = message.metadata?.providerMessage
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  const payload = candidate as StudioStoredAssistantPayload
  const content = normalizeStoredContent(payload.content)
  const reasoning = cloneStoredReasoningContent(payload.reasoning_content)
  logger.debug('readStoredAssistantPayload', {
    role: message.role,
    hasProviderMessage: Boolean(candidate),
    contentType: typeof payload.content,
    contentIsArray: Array.isArray(payload.content),
    contentLength: Array.isArray(payload.content) ? payload.content.length : typeof payload.content === 'string' ? payload.content.length : undefined,
    hasReasoningContent: Boolean(reasoning),
    reasoningLength: typeof reasoning === 'string'
      ? reasoning.length
      : Array.isArray(reasoning)
        ? reasoning.length
        : undefined,
    hasToolCalls: Array.isArray(payload.tool_calls),
    toolCallsLength: payload.tool_calls?.length,
  })
  if (content === undefined && !Array.isArray(payload.tool_calls) && !reasoning) {
    return null
  }

  return {
    content: content ?? null,
    reasoning_content: reasoning,
    tool_calls: cloneStoredToolCalls(payload.tool_calls)
  }
}

/**
 * 规范化存储的工具调用数组
 * @param toolCalls - 存储的工具调用数组
 * @returns 规范化后的工具调用数组，如果为空则返回 undefined
 */
function cloneStoredToolCalls(
  toolCalls: StudioStoredAssistantToolCall[] | undefined
): StudioStoredAssistantToolCall[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined
  }
  return toolCalls.map((toolCall) => cloneUnknownValue(toolCall) as StudioStoredAssistantToolCall)
}

/**
 * 规范化存储的内容
 * @param content - 存储的内容
 * @returns 规范化后的内容（字符串、对象数组、null 或 undefined）
 */
function normalizeStoredContent(content: unknown): string | Array<Record<string, unknown>> | null | undefined {
  if (content === null) {
    return null
  }
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  }
  return undefined
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
 * 将助手消息的多个部分扁平化为纯文本
 * @param message -助手消息对象
 * @returns 合并后的文本内容
 */
function flattenAssistantMessage(message: Extract<StudioMessage, { role: 'assistant' }>): string {
  const sections: string[] = []

  const reasoning = message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text.trim())
    .filter(Boolean)
  if (reasoning.length) {
    sections.push(['[reasoning]', ...reasoning].join('\n'))
  }

  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
  if (text.length) {
    sections.push(text.join('\n\n'))
  }

  return sections.join('\n\n').trim()
}

/**
 * 构建用户消息内容，支持文本和参考图片
 * @param inputText - 输入文本
 * @returns 纯文本或包含文本和图片的数组
 */
function buildUserMessageContent(
  inputText: string,
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: VisionImageDetail } }> {
  const parsed = parseReferenceImagesFromInput(inputText)
  if (parsed.referenceImages.length === 0) {
    return inputText
  }

  return [
    {
      type: 'text',
      text: parsed.text || 'Use the provided reference images as context.',
    },
    ...parsed.referenceImages.map((image) => ({
      type: 'image_url' as const,
      image_url: {
        url: image.url,
        detail: image.detail || 'auto',
      },
    })),
  ]
}

/**
 * 从输入文本中解析参考图片
 * @param inputText - 输入文本
 * @returns 包含纯文本和参考图片数组的对象
 */
function parseReferenceImagesFromInput(inputText: string): {
  text: string
  referenceImages: ReferenceImage[]
} {
  const startIndex = inputText.indexOf(REFERENCE_IMAGES_START)
  const endIndex = inputText.indexOf(REFERENCE_IMAGES_END)
  if (startIndex < 0 || endIndex < startIndex) {
    return {
      text: inputText,
      referenceImages: [],
    }
  }

  const before = inputText.slice(0, startIndex).trimEnd()
  const after = inputText.slice(endIndex + REFERENCE_IMAGES_END.length).trimStart()
  const block = inputText.slice(startIndex + REFERENCE_IMAGES_START.length, endIndex)

  return {
    text: [before, after].filter(Boolean).join('\n\n'),
    referenceImages: extractReferenceImages(block),
  }
}

/**
 * 从文本块中提取参考图片
 * @param block - 包含图片信息的文本块
 * @returns 参考图片数组
 */
function extractReferenceImages(block: string): ReferenceImage[] {
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map(parseReferenceImageLine)
    .filter((image): image is ReferenceImage => Boolean(image))
}

/**
 * 解析单行参考图片信息
 * @param line - 包含图片信息的文本行
 * @returns 参考图片对象，如果解析失败则返回 null
 */
function parseReferenceImageLine(line: string): ReferenceImage | null {
  const match = line.match(/^-+\s*[^:]+:\s*(https?:\/\/\S+?)(?:\s+\(detail:\s*(auto|low|high)\))?\s*$/i)
  if (!match) {
    return null
  }

  return {
    url: match[1],
    detail: normalizeDetail(match[2]),
  }
}

/**
 * 规范化图片细节参数
 * @param value - 图片细节字符串
 * @returns 规范化后的图片细节值（'low'、'high' 或 'auto'）
 */
function normalizeDetail(value: string | undefined): VisionImageDetail {
  if (value === 'low' || value === 'high' || value === 'auto') {
    return value
  }
  return 'auto'
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



