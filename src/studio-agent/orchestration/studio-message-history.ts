import type OpenAI from 'openai'
import type { StudioAssistantMessage, StudioMessage, StudioToolPart } from '../domain/types'
import {
  type StudioStoredAssistantPayload,
  type StudioStoredAssistantToolCall,
} from './studio-provider-message'

export function buildStudioConversationMessages(input: {
  messages: StudioMessage[]
}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return input.messages.flatMap(toConversationMessages)
}

function toConversationMessages(message: StudioMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (message.role === 'user') {
    return [{ role: 'user', content: message.text }]
  }

  if (message.role !== 'assistant') {
    return []
  }

  const raw = readStoredAssistantPayload(message)
  const toolMessages = buildToolMessages(message)
  if (raw) {
    const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: raw.content as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam['content'],
      tool_calls: raw.tool_calls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
    }

    const conversationMessages = [
      assistantMessage,
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

function readStoredAssistantPayload(message: StudioAssistantMessage): {
  content: string | Array<Record<string, unknown>> | null
  tool_calls?: StudioStoredAssistantToolCall[]
} | null {
  const candidate = message.metadata?.providerMessage
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  const payload = candidate as StudioStoredAssistantPayload
  const content = normalizeStoredContent(payload.content)
  if (content === undefined && !Array.isArray(payload.tool_calls)) {
    return null
  }

  return {
    content: content ?? null,
    tool_calls: Array.isArray(payload.tool_calls) ? payload.tool_calls : undefined
  }
}

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

