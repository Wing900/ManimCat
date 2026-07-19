import { createCustomOpenAIClient } from './openai-client-factory'
import { createChatCompletionText } from './openai-stream'
import { buildTokenParams } from '../utils/reasoning-model'
import { createLogger } from '../utils/logger'
import { getRoleSystemPrompt, getRoleUserPrompt } from '../prompts'
import { buildVisionUserMessage, shouldRetryWithoutImages } from './concept-designer-utils'
import type { CustomApiConfig, PromptLocale, PromptOverrides, ReferenceImage } from '../types'
import {
  extractProblemFramingJson,
  normalizeProblemFramingPlan,
  type ProblemFramingPlan,
} from '../workflow/problem-framing/parser'
import { executeProblemFramingWithImageFallback } from '../workflow/problem-framing/retry'

const logger = createLogger('ProblemFraming')

const PLANNER_TEMPERATURE = parseFloat(process.env.PROBLEM_FRAMING_TEMPERATURE || '0.7')
const PLANNER_MAX_TOKENS = parseInt(process.env.PROBLEM_FRAMING_MAX_TOKENS || '2400', 10)
const PLANNER_THINKING_TOKENS = parseInt(process.env.PROBLEM_FRAMING_THINKING_TOKENS || '4000', 10)

export type { ProblemFramingPlan } from '../workflow/problem-framing/parser'

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

  const response = await executeProblemFramingWithImageFallback({
    hasReferenceImages: Boolean(params.referenceImages?.length),
    execute: (useImages) => createChatCompletionText(
      client,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: useImages ? buildVisionUserMessage(userPrompt, params.referenceImages) : userPrompt }
        ],
        temperature: PLANNER_TEMPERATURE,
        ...buildTokenParams(PLANNER_THINKING_TOKENS, PLANNER_MAX_TOKENS)
      },
      {
        fallbackToNonStream: true,
        usageLabel: useImages ? 'problem-framing' : 'problem-framing-text-fallback'
      }
    ),
    shouldRetryWithoutImages,
    onImageFallback: (error) => {
      logger.warn('Problem framing model does not support reference images, retrying with text only', {
        concept: params.concept,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  const parsed = JSON.parse(extractProblemFramingJson(response.content))
  const plan = normalizeProblemFramingPlan(parsed, locale)

  logger.info('Problem framing completed', {
    mode: plan.mode,
    headline: plan.headline,
    stepCount: plan.steps.length
  })

  return plan
}
