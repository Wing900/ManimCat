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

  const fallbackStepTitle = locale === 'en-US' ? 'Step' : '步骤'
  const fallbackStepContent = locale === 'en-US'
    ? 'Continue clarifying the visual direction and storytelling order for this part.'
    : '继续细化这一段的可视化表达和叙事顺序。'
  const fallbackHeadline = locale === 'en-US' ? 'A fresh visualization plan' : '新的可视化方案'
  const fallbackSummary = locale === 'en-US'
    ? 'The expression path has been organized more clearly.'
    : '整理出一个更清晰的表达路径。'
  const fallbackMotif = locale === 'en-US' ? 'Cat paws are sorting the steps across the card.' : '猫爪在卡片上整理出步骤。'
  const fallbackHint = locale === 'en-US'
    ? 'The next designer stage should expand these three steps into concrete animation design.'
    : '下一阶段继续把三步扩成具体动画设计。'

  const steps = Array.isArray(input.steps) ? input.steps : []
  const normalizedSteps = steps
    .slice(0, 5)
    .map((step, index) => {
      const item = step && typeof step === 'object' ? step as { title?: unknown; content?: unknown } : {}
      return {
        title: sanitizeString(item.title, `${fallbackStepTitle} ${index + 1}`),
        content: sanitizeString(item.content, ''),
      }
    })
    .filter((step) => step.content)

  while (normalizedSteps.length < 3) {
    normalizedSteps.push({
      title: `${fallbackStepTitle} ${normalizedSteps.length + 1}`,
      content: fallbackStepContent,
    })
  }

  return {
    mode: input.mode === 'clarify' ? 'clarify' : 'invent',
    headline: sanitizeString(input.headline, fallbackHeadline),
    summary: sanitizeString(input.summary, fallbackSummary),
    steps: normalizedSteps,
    visualMotif: sanitizeString(input.visualMotif ?? input.visual_motif, fallbackMotif),
    designerHint: sanitizeString(input.designerHint ?? input.designer_hint, fallbackHint),
  }
}
