import type OpenAI from 'openai'
import type { StudioMessage, StudioToolPart } from '../domain/types'

export function buildStudioConversationMessages(input: {
  messages: StudioMessage[]
}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return input.messages
    .map(toConversationMessage)
    .filter((message): message is OpenAI.Chat.Completions.ChatCompletionMessageParam => !!message)
}

function toConversationMessage(message: StudioMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam | null {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.text
    }
  }

  if (message.role !== 'assistant') {
    return null
  }

  const content = flattenAssistantMessage(message)
  if (!content) {
    return null
  }

  return {
    role: 'assistant',
    content
  }
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

  const toolOutputs = message.parts
    .filter((part): part is StudioToolPart => part.type === 'tool' && part.state.status === 'completed')
    .map((part) => {
      const state = part.state
      if (state.status !== 'completed') {
        return ''
      }
      const title = state.title || `Completed ${part.tool}`
      return [`[tool:${part.tool}] ${title}`, state.output].join('\n')
    })
    .filter(Boolean)
  if (toolOutputs.length) {
    sections.push(toolOutputs.join('\n\n'))
  }

  return sections.join('\n\n').trim()
}
