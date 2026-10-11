import type { PromptLocale } from '../../types'

export interface ProblemFramingStep {
  title: string
  content: string
}

export interface ProblemFramingPlan {
  mode: 'clarify' | 'invent'
  headline: string
  summary: string
  steps: ProblemFramingStep[]
  visualMotif: string
  designerHint: string
}

export class ProblemFramingFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProblemFramingFormatError'
  }
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

export function extractProblemFramingJson(text: string): string {
  const cleaned = stripCodeFence(text)
  if (/^\s*<!DOCTYPE\s+html/i.test(cleaned) || /^\s*<html/i.test(cleaned)) {
    throw new Error('Problem framing response was HTML, not JSON')
  }

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Problem framing response did not contain a JSON object')
  }

  return cleaned.slice(start, end + 1)
}

function decodeTagText(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim()
}

function extractCompleteTag(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'))
  return match?.[1] === undefined ? undefined : decodeTagText(match[1])
}

function extractCompleteTagBlocks(text: string, tag: string): string[] {
  const blocks: string[] = []
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi')
  for (const match of text.matchAll(expression)) {
    if (match[1] !== undefined) {
      blocks.push(match[1])
    }
  }
  return blocks
}

function parseTaggedPlan(text: string, locale: PromptLocale): ProblemFramingPlan {
  const cleaned = stripCodeFence(text)
  if (/^\s*<!DOCTYPE\s+html/i.test(cleaned) || /^\s*<html/i.test(cleaned)) {
    throw new ProblemFramingFormatError('Problem framing response was HTML, not a tagged plan')
  }

  const headline = extractCompleteTag(cleaned, 'headline')
  const summary = extractCompleteTag(cleaned, 'summary')
  const steps = extractCompleteTagBlocks(cleaned, 'step')
    .map((block) => ({
      title: extractCompleteTag(block, 'title') || '',
      content: extractCompleteTag(block, 'content') || '',
    }))
    .filter((step) => step.title && step.content)
    .slice(0, 6)

  if (!headline || !summary || steps.length < 3) {
    throw new ProblemFramingFormatError(
      `Tagged plan requires headline, summary, and at least 3 complete steps; received ${steps.length} steps`,
    )
  }

  return normalizeProblemFramingPlan({
    mode: extractCompleteTag(cleaned, 'mode'),
    headline,
    summary,
    steps,
    visualMotif: extractCompleteTag(cleaned, 'visual_motif'),
    designerHint: extractCompleteTag(cleaned, 'designer_hint'),
  }, locale)
}

export function parseProblemFramingResponse(text: string, locale: PromptLocale): ProblemFramingPlan {
  const cleaned = stripCodeFence(text)
  const hasTaggedPlan = /<(?:plan|headline|steps?|step)>/i.test(cleaned)

  if (hasTaggedPlan) {
    return parseTaggedPlan(cleaned, locale)
  }

  try {
    return normalizeProblemFramingPlan(JSON.parse(extractProblemFramingJson(cleaned)), locale)
  } catch (error) {
    if (error instanceof ProblemFramingFormatError) {
      throw error
    }
    throw new ProblemFramingFormatError(
      `Problem framing response matched neither the tagged protocol nor legacy JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized || fallback
}

export function normalizeProblemFramingPlan(raw: unknown, locale: PromptLocale): ProblemFramingPlan {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Problem framing response was not an object')
  }

  const input = raw as {
    mode?: unknown
    headline?: unknown
    summary?: unknown
    steps?: unknown
    visualMotif?: unknown
    visual_motif?: unknown
    designerHint?: unknown
    designer_hint?: unknown
  }

  // The parser never invents user-visible content: a plan the model did not write is a format error the
  // caller can repair, not a card filled with placeholder text. Only the decoration fields below keep a
  // neutral default, and nothing renders them (no `visualMotif`/`designerHint` consumer in frontend/src).
  const fallbackMotif = locale === 'en-US' ? 'Cat paws are sorting the steps across the card.' : '猫爪在卡片上整理出步骤。'
  const fallbackHint = locale === 'en-US'
    ? 'The next designer stage should expand these three steps into concrete animation design.'
    : '下一阶段继续把三步扩成具体动画设计。'

  const steps = Array.isArray(input.steps) ? input.steps : []
  const normalizedSteps = steps
    .slice(0, 5)
    .map((step) => {
      const item = step && typeof step === 'object' ? step as { title?: unknown; content?: unknown } : {}
      return {
        title: sanitizeString(item.title, ''),
        content: sanitizeString(item.content, ''),
      }
    })
    .filter((step) => step.title && step.content)

  const headline = sanitizeString(input.headline, '')
  const summary = sanitizeString(input.summary, '')
  const missing: string[] = []
  if (!headline) {
    missing.push('headline')
  }
  if (!summary) {
    missing.push('summary')
  }
  if (normalizedSteps.length < 3) {
    missing.push(`at least 3 complete steps (received ${normalizedSteps.length})`)
  }
  if (missing.length > 0) {
    // This message lands in the repair prompt, so it names exactly what the model must supply.
    throw new ProblemFramingFormatError(`Plan is missing required content: ${missing.join(', ')}`)
  }

  return {
    mode: input.mode === 'clarify' ? 'clarify' : 'invent',
    headline,
    summary,
    steps: normalizedSteps,
    visualMotif: sanitizeString(input.visualMotif ?? input.visual_motif, fallbackMotif),
    designerHint: sanitizeString(input.designerHint ?? input.designer_hint, fallbackHint),
  }
}
