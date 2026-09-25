import { createCustomOpenAIClient } from './openai-client-factory'
import { createChatCompletionText } from './openai-stream'
import { buildTokenParams } from '../utils/reasoning-model'
import { createLogger } from '../utils/logger'
import { getRoleSystemPrompt, getRoleUserPrompt } from '../prompts'
import { buildVisionUserMessage, shouldRetryWithoutImages } from './concept-designer-utils'
import type { CustomApiConfig, PromptLocale, PromptOverrides, ReferenceImage } from '../types'
import { ServiceUnavailableError } from '../utils/errors'
import { ProblemFramingFormatError, type ProblemFramingPlan } from '../workflow/problem-framing/parser'
import { parseProblemFramingWithRepair } from '../workflow/problem-framing/format-repair'
import { executeProblemFramingWithImageFallback } from '../workflow/problem-framing/retry'

const logger = createLogger('ProblemFraming')

const PLANNER_TEMPERATURE = parseFloat(process.env.PROBLEM_FRAMING_TEMPERATURE || '0.7')
const PLANNER_MAX_TOKENS = parseInt(process.env.PROBLEM_FRAMING_MAX_TOKENS || '2400', 10)
const PLANNER_THINKING_TOKENS = parseInt(process.env.PROBLEM_FRAMING_THINKING_TOKENS || '4000', 10)
const PLANNER_FORMAT_RETRIES = parseInt(process.env.PROBLEM_FRAMING_FORMAT_RETRIES || '2', 10)
const FORMAT_REPAIR_INPUT_LIMIT = 16_000

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

  let plan: ProblemFramingPlan
  try {
    plan = await parseProblemFramingWithRepair({
      content: response.content,
      locale,
      maxRepairAttempts: Math.max(0, PLANNER_FORMAT_RETRIES),
      repair: async ({ content, error, attempt }) => {
        logger.warn('Problem framing format invalid, requesting format repair', {
          attempt,
          error,
          contentLength: content.length,
        })

        const repairResponse = await createChatCompletionText(
          client,
          {
            model,
            messages: [
              {
                role: 'system',
                content: locale === 'en-US'
                  ? 'Repair formatting only. Preserve the meaning. Output one complete <plan> block with <mode>, <headline>, <summary>, <steps>, 3-5 repeated <step><title>...</title><content>...</content></step> blocks, <visual_motif>, and <designer_hint>. Output no other text.'
                  : '只修复格式，保留原意。仅输出一个完整 <plan> 块，包含 <mode>、<headline>、<summary>、<steps>、3–5 个重复的 <step><title>...</title><content>...</content></step>、<visual_motif>、<designer_hint>，标签外不输出文字。',
              },
              {
                role: 'user',
                content: `Parser error: ${error}\n\nModel output:\n${content.slice(0, FORMAT_REPAIR_INPUT_LIMIT)}`,
              },
            ],
            temperature: 0,
            ...buildTokenParams(0, PLANNER_MAX_TOKENS),
          },
          {
            fallbackToNonStream: true,
            usageLabel: `problem-framing-format-repair-${attempt}`,
          },
        )

        return repairResponse.content
      },
    })
  } catch (error) {
    if (!(error instanceof ProblemFramingFormatError)) {
      throw error
    }
    logger.error('Problem framing format repair exhausted', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw new ServiceUnavailableError(
      locale === 'en-US'
        ? 'The planning card format could not be recovered. Please retry.'
        : '规划卡格式修复失败，请重试。',
      { code: 'PLAN_FORMAT_INVALID', retryable: true },
    )
  }

  logger.info('Problem framing completed', {
    mode: plan.mode,
    headline: plan.headline,
    stepCount: plan.steps.length
  })

  return plan
}
