import { createCustomOpenAIClient } from './openai-client-factory'
import { createChatCompletionText } from './openai-stream'
import { buildTokenParams } from '../utils/reasoning-model'
import { createLogger } from '../utils/logger'
import { getRoleSystemPrompt, getRoleUserPrompt } from '../prompts'
import { buildVisionUserMessage, shouldRetryWithoutImages } from './concept-designer-utils'
import type { CustomApiConfig, PromptLocale, PromptOverrides, ReferenceImage } from '../types'

const logger = createLogger('ProblemFraming')

const PLANNER_TEMPERATURE = parseFloat(process.env.PROBLEM_FRAMING_TEMPERATURE || '0.7')
const PLANNER_MAX_TOKENS = parseInt(process.env.PROBLEM_FRAMING_MAX_TOKENS || '2400', 10)
const PLANNER_THINKING_TOKENS = parseInt(process.env.PROBLEM_FRAMING_THINKING_TOKENS || '4000', 10)

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

interface ProblemFramingParams {
  concept: string
  feedback?: string
  feedbackHistory?: string[]
  currentPlan?: ProblemFramingPlan
  referenceImages?: ReferenceImage[]
  customApiConfig: CustomApiConfig
  locale?: PromptLocale
  promptOverrides?: PromptOverrides
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

function extractJsonObject(text: string): string {
  const cleaned = stripCodeFence(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Problem framing response did not contain a JSON object')
  }

  return cleaned.slice(start, end + 1)
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized || fallback
}

function normalizePlan(raw: unknown, locale: PromptLocale): ProblemFramingPlan {
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
  const fallbackStepContent =
    locale === 'en-US'
      ? 'Continue clarifying the visual direction and storytelling order for this part.'
      : '继续细化这一段的可视化表达和叙事顺序。'
  const fallbackHeadline = locale === 'en-US' ? 'A fresh visualization plan' : '新的可视化方案'
  const fallbackSummary = locale === 'en-US' ? 'The expression path has been organized more clearly.' : '整理出一个更清晰的表达路径。'
  const fallbackMotif = locale === 'en-US' ? 'Cat paws are sorting the steps across the card.' : '猫爪在卡片上整理出步骤。'
  const fallbackHint = locale === 'en-US' ? 'The next designer stage should expand these three steps into concrete animation design.' : '下一阶段继续把三步扩成具体动画设计。'

  const steps = Array.isArray(input.steps) ? input.steps : []
  const normalizedSteps = steps
    .slice(0, 5)
    .map((step, index) => {
      const item = step && typeof step === 'object' ? step as { title?: unknown; content?: unknown } : {}
      return {
        title: sanitizeString(item.title, `${fallbackStepTitle} ${index + 1}`),
        content: sanitizeString(item.content, '')
      }
    })
    .filter((step) => step.content)

  while (normalizedSteps.length < 3) {
    normalizedSteps.push({
      title: `${fallbackStepTitle} ${normalizedSteps.length + 1}`,
      content: fallbackStepContent
    })
  }

  return {
    mode: input.mode === 'clarify' ? 'clarify' : 'invent',
    headline: sanitizeString(input.headline, fallbackHeadline),
    summary: sanitizeString(input.summary, fallbackSummary),
    steps: normalizedSteps,
    visualMotif: sanitizeString(input.visualMotif ?? input.visual_motif, fallbackMotif),
    designerHint: sanitizeString(input.designerHint ?? input.designer_hint, fallbackHint)
  }
}

export async function generateProblemFramingPlan(params: ProblemFramingParams): Promise<ProblemFramingPlan> {
  const locale = params.locale === 'en-US' ? 'en-US' : 'zh-CN'
  const client = createCustomOpenAIClient(params.customApiConfig)
  const model = (params.customApiConfig.model || '').trim()

  if (!model) {
    throw new Error('No model available')
  }

  logger.info('Problem framing started', {
    locale,
    conceptLength: params.concept.length,
    hasFeedback: !!params.feedback,
    hasCurrentPlan: !!params.currentPlan,
    hasImages: !!params.referenceImages?.length
  })

  const promptOverrides: PromptOverrides = { ...params.promptOverrides, locale }
  const systemPrompt = getRoleSystemPrompt('problemFraming', promptOverrides)
  const userPrompt = getRoleUserPrompt(
    'problemFraming',
    {
      concept: params.concept,
      instructions: params.feedback,
      feedbackHistory: params.feedbackHistory?.length ? params.feedbackHistory.map((item, index) => `${index + 1}. ${item}`).join('\n') : undefined,
      sceneDesign: params.currentPlan ? JSON.stringify(params.currentPlan, null, 2) : undefined
    },
    promptOverrides
  )

  let response: Awaited<ReturnType<typeof createChatCompletionText>>
  try {
    response = await createChatCompletionText(
      client,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildVisionUserMessage(userPrompt, params.referenceImages) }
        ],
        temperature: PLANNER_TEMPERATURE,
        ...buildTokenParams(PLANNER_THINKING_TOKENS, PLANNER_MAX_TOKENS)
      },
      { fallbackToNonStream: true, usageLabel: 'problem-framing' }
    )
  } catch (error) {
    if (params.referenceImages && params.referenceImages.length > 0 && shouldRetryWithoutImages(error)) {
      logger.warn('Problem framing model does not support reference images, retrying with text only', {
        concept: params.concept,
        error: error instanceof Error ? error.message : String(error)
      })
      response = await createChatCompletionText(
        client,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: PLANNER_TEMPERATURE,
          ...buildTokenParams(PLANNER_THINKING_TOKENS, PLANNER_MAX_TOKENS)
        },
        { fallbackToNonStream: true, usageLabel: 'problem-framing-text-fallback' }
      )
    } else {
      throw error
    }
  }

  const parsed = JSON.parse(extractJsonObject(response.content))
  const plan = normalizePlan(parsed, locale)

  logger.info('Problem framing completed', {
    mode: plan.mode,
    headline: plan.headline,
    stepCount: plan.steps.length
  })

  return plan
}
