import type { PromptLocale, ProblemFramingPlan, ProblemFramingStep } from '../../types'
export type { ProblemFramingPlan, ProblemFramingStep } from '../../types'

const DESIGN_FIELDS = {
  question: 'question', answer: 'answer', audience: 'audience',
  backgroundRules: 'background_rules', selectedRoute: 'selected_route',
  alternativeRoutes: 'alternative_routes', outOfScope: 'out_of_scope', specialCases: 'special_cases',
} as const
const PHASES = ['background', 'phenomenon', 'derivation', 'closing'] as const

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
      phase: extractCompleteTag(block, 'phase'),
    }))
    .filter((step) => step.title && step.content)

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
    ...Object.fromEntries(Object.entries(DESIGN_FIELDS).map(([key, tag]) => [key, extractCompleteTag(cleaned, tag)])),
  }, locale)
}

export function parseProblemFramingResponse(text: string, locale: PromptLocale, requireDesignFields = false): ProblemFramingPlan {
  const cleaned = stripCodeFence(text)
  const hasTaggedPlan = /<(?:plan|headline|steps?|step)>/i.test(cleaned)

  if (hasTaggedPlan) {
    return validatePlanContract(parseTaggedPlan(cleaned, locale), requireDesignFields)
  }

  try {
    return validatePlanContract(normalizeProblemFramingPlan(JSON.parse(extractProblemFramingJson(cleaned)), locale), requireDesignFields)
  } catch (error) {
    if (error instanceof ProblemFramingFormatError) {
      throw error
    }
    throw new ProblemFramingFormatError(
      `Problem framing response matched neither the tagged protocol nor legacy JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validatePlanContract(plan: ProblemFramingPlan, required: boolean): ProblemFramingPlan {
  if (!required) return plan
  const missing = Object.keys(DESIGN_FIELDS).filter(key => !plan[key as keyof typeof DESIGN_FIELDS])
  if (plan.steps.some(step => !step.phase)) missing.push('phase for each step')
  if (missing.length) throw new ProblemFramingFormatError(`Expanded plan requires ${missing.join(', ')}`)
  return plan
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

  const input = raw as Record<string, unknown> & {
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
  // neutral default for legacy cards; the expanded design contract is validated separately.
  const fallbackMotif = locale === 'en-US' ? 'Cat paws are sorting the steps across the card.' : '猫爪在卡片上整理出步骤。'
  const fallbackHint = locale === 'en-US'
    ? 'The next designer stage should expand the planned steps into concrete animation design.'
    : '下一阶段把规划步骤展开为具体动画设计。'

  const steps = Array.isArray(input.steps) ? input.steps : []
  const normalizedSteps = steps
    .map((step) => {
      const item = step && typeof step === 'object' ? step as { title?: unknown; content?: unknown; phase?: unknown } : {}
      if (item.phase !== undefined && !PHASES.includes(item.phase as typeof PHASES[number])) {
        throw new ProblemFramingFormatError('Step phase must be background, phenomenon, derivation, or closing')
      }
      return {
        title: sanitizeString(item.title, ''),
        content: sanitizeString(item.content, ''),
        ...(item.phase === undefined ? {} : { phase: item.phase as ProblemFramingStep['phase'] }),
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
  if (steps.length > 12) {
    missing.push('at most 12 steps; reduce the plan explicitly instead of truncating it')
  }
  const designFields: Partial<ProblemFramingPlan> = {}
  for (const [key, alias] of Object.entries(DESIGN_FIELDS)) {
    const value = input[key] ?? input[alias]
    if (value !== undefined) {
      const text = sanitizeString(value, '')
      if (!text) missing.push(key)
      else Object.assign(designFields, { [key]: text })
    }
  }
  // Legacy cards remain readable; expanded cards must carry all their design decisions.
  if (Object.keys(designFields).length > 0) {
    for (const key of Object.keys(DESIGN_FIELDS)) if (!(key in designFields) && !missing.includes(key)) missing.push(key)
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
    ...designFields,
  }
}
