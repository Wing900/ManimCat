import { getRoleSystemPrompt, getRoleUserPrompt } from '../../prompts'
import type { PromptOverrides, ProblemFramingPlan } from '../../types'
import type { CodeRetryContext } from './types'
import { formatProblemFramingPlan } from '../generation/request-preparation'

export function getCodeRetrySystemPrompt(promptOverrides?: PromptOverrides): string {
  return getRoleSystemPrompt('codeRetry', promptOverrides)
}

export function buildRetryFixPrompt(
  concept: string,
  errorMessage: string,
  code: string,
  codeSnippet: string | undefined,
  attempt: number | string,
  outputMode: 'video' | 'image',
  promptOverrides?: PromptOverrides,
  problemPlan?: ProblemFramingPlan,
  sceneDesign?: string
): string {
  return getRoleUserPrompt(
    'codeRetry',
    {
      concept,
      plan: formatProblemFramingPlan(problemPlan),
      sceneDesign,
      errorMessage,
      code,
      codeSnippet,
      attempt: Number(attempt),
      outputMode,
      isImage: outputMode === 'image',
      isVideo: outputMode === 'video'
    },
    promptOverrides
  )
}

export function buildRetryPrompt(
  context: CodeRetryContext,
  errorMessage: string,
  attempt: number,
  currentCode: string,
  codeSnippet?: string
): string {
  return buildRetryFixPrompt(
    context.concept,
    errorMessage,
    currentCode,
    codeSnippet,
    attempt,
    context.outputMode,
    context.promptOverrides,
    context.problemPlan,
    context.sceneDesign
  )
}
