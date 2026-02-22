import crypto from 'crypto'
import { getSharedModule, getRoleUserPrompt } from '../../prompts'
import type { PromptOverrides } from '../../types'
import type { CodeRetryContext } from './types'
import { buildInitialCodePrompt, CODE_RETRY_SYSTEM_PROMPT } from './prompts'

function applyPromptTemplate(
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

function generateSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

export function getCodeRetrySystemPrompt(promptOverrides?: PromptOverrides): string {
  return promptOverrides?.roles?.codeRetry?.system || CODE_RETRY_SYSTEM_PROMPT
}

function buildInitialPrompt(
  concept: string,
  seed: string,
  sceneDesign: string,
  promptOverrides?: PromptOverrides
): string {
  const override = promptOverrides?.roles?.codeRetry?.user
  if (override) {
    return applyPromptTemplate(override, { concept, seed, sceneDesign }, promptOverrides)
  }
  return buildInitialCodePrompt(concept, seed, sceneDesign, promptOverrides)
}

export function buildRetryFixPrompt(
  concept: string,
  errorMessage: string,
  attempt: number | string,
  promptOverrides?: PromptOverrides
): string {
  return getRoleUserPrompt(
    'codeRetry',
    {
      concept,
      errorMessage,
      attempt: Number(attempt)
    },
    promptOverrides
  )
}

export function buildRetryPrompt(
  context: CodeRetryContext,
  errorMessage: string,
  attempt: number
): string {
  const override = context.promptOverrides?.roles?.codeRetry?.user
  if (override) {
    return applyPromptTemplate(
      override,
      {
        concept: context.concept,
        errorMessage,
        attempt: String(attempt)
      },
      context.promptOverrides
    )
  }
  return buildRetryFixPrompt(context.concept, errorMessage, attempt, context.promptOverrides)
}

export function buildContextOriginalPrompt(
  concept: string,
  sceneDesign: string,
  promptOverrides?: PromptOverrides
): string {
  const seed = generateSeed(concept)
  return buildInitialPrompt(concept, seed, sceneDesign, promptOverrides)
}
