import OpenAI from 'openai'
import crypto from 'crypto'
import { getSharedModule } from '../prompts'
import type { PromptOverrides, ReferenceImage, VisionImageDetail } from '../types'

export function generateUniqueSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

export function applyPromptTemplate(
  template: string,
  values: Record<string, string>,
  promptOverrides?: PromptOverrides
): string {
  let output = template

  output = output.replace(/\{\{knowledge\}\}/g, getSharedModule('knowledge', promptOverrides))
  output = output.replace(/\{\{rules\}\}/g, getSharedModule('rules', promptOverrides))

  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value || '')
  }
  return output
}

export function buildVisionUserMessage(
  userPrompt: string,
  referenceImages?: ReferenceImage[]
):
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: VisionImageDetail } }> {
  if (!referenceImages || referenceImages.length === 0) {
    return userPrompt
  }

  return [
    {
      type: 'text',
      text: `${userPrompt}\n\n你还会收到参考图片。请根据图片中显示的对象、结构和关系来设计动画。`
    },
    ...referenceImages.map((image) => ({
      type: 'image_url' as const,
      image_url: {
        url: image.url,
        detail: image.detail || 'auto'
      }
    }))
  ]
}

export function shouldRetryWithoutImages(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) {
    return false
  }

  if (error.status && error.status >= 500) {
    return false
  }

  return /image|vision|multimodal|content.?part|unsupported/i.test(error.message || '')
}

export function extractDesignFromResponse(text: string): string {
  if (!text) return ''
  const sanitized = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const match = sanitized.match(/<design>([\s\S]*?)<\/design>/i)
  if (match) {
    return match[1].trim()
  }
  return sanitized.trim()
}

export function extractCodeFromResponse(text: string): string {
  if (!text) return ''
  const sanitized = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const anchorMatch = sanitized.match(/### START ###([\s\S]*?)### END ###/)
  if (anchorMatch) {
    return anchorMatch[1].trim()
  }
  const codeMatch = sanitized.match(/```(?:python)?([\s\S]*?)```/i)
  if (codeMatch) {
    return codeMatch[1].trim()
  }
  return sanitized.trim()
}

export function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

export function buildCompletionDiagnostics(response: unknown): Record<string, unknown> {
  const r = response as {
    model?: unknown
    usage?: {
      prompt_tokens?: unknown
      completion_tokens?: unknown
      total_tokens?: unknown
    }
    choices?: Array<{ finish_reason?: unknown; message?: unknown }>
  }

  const choice = r.choices?.[0]
  const message = (choice?.message || {}) as Record<string, unknown>
  const rawContent = message.content
  const normalizedContent = normalizeMessageContent(rawContent)
  const refusal = message.refusal
  const reasoningContent = message.reasoning_content

  return {
    model: r.model,
    finishReason: choice?.finish_reason ?? null,
    messageKeys: Object.keys(message),
    rawContentType: Array.isArray(rawContent) ? 'array' : typeof rawContent,
    rawContentIsEmptyArray: Array.isArray(rawContent) ? rawContent.length === 0 : undefined,
    normalizedContentLength: normalizedContent.length,
    hasRefusal: !!refusal,
    refusalPreview: typeof refusal === 'string' ? refusal.slice(0, 200) : undefined,
    hasReasoningContent: !!reasoningContent,
    reasoningContentType: Array.isArray(reasoningContent) ? 'array' : typeof reasoningContent,
    usage: r.usage
      ? {
          promptTokens: r.usage.prompt_tokens,
          completionTokens: r.usage.completion_tokens,
          totalTokens: r.usage.total_tokens
        }
      : undefined
  }
}

export interface CleanDesignResult {
  text: string
  changes: string[]
}

export function cleanDesignText(text: string): CleanDesignResult {
  const changes: string[] = []
  let cleaned = text

  const beforeLength = cleaned.length
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  if (cleaned.length !== beforeLength) {
    changes.push('remove-extra-newlines')
  }

  cleaned = cleaned.trim()

  return { text: cleaned, changes }
}
