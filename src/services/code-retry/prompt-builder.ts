import crypto from 'crypto'
import { getSharedModule, getRoleSystemPrompt, getRoleUserPrompt } from '../../prompts'
import type { PromptOverrides } from '../../types'
import type { CodeRetryContext } from './types'
import { buildInitialCodePrompt } from './prompts'

function applyPromptTemplate(
  template: string,
  values: Record<string, string | boolean>,
  promptOverrides?: PromptOverrides
): string {
  let output = template

  output = output.replace(/\{\{knowledge\}\}/g, getSharedModule('knowledge', promptOverrides))
  output = output.replace(/\{\{rules\}\}/g, getSharedModule('rules', promptOverrides))

  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value))
  }
  return output
}

function generateSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

export function getCodeRetrySystemPrompt(promptOverrides?: PromptOverrides): string {
  return getRoleSystemPrompt('codeRetry', promptOverrides)
}

function buildInitialPrompt(
  concept: string,
  seed: string,
  sceneDesign: string,
  outputMode: 'video' | 'image',
  promptOverrides?: PromptOverrides
): string {
  return buildInitialCodePrompt(concept, seed, sceneDesign, outputMode, promptOverrides)
}

export function buildRetryFixPrompt(
  concept: string,
  errorMessage: string,
  code: string,
  attempt: number | string,
  outputMode: 'video' | 'image',
  promptOverrides?: PromptOverrides
): string {
  return getRoleUserPrompt(
    'codeRetry',
    {
      concept,
      errorMessage,
      code,
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
  currentCode: string
): string {
  const override = context.promptOverrides?.roles?.codeRetry?.user
  if (override) {
    return applyPromptTemplate(
      override,
      {
        concept: context.concept,
        errorMessage,
        code: currentCode,
        attempt: String(attempt),
        outputMode: context.outputMode,
        isImage: context.outputMode === 'image',
        isVideo: context.outputMode === 'video'
      },
      context.promptOverrides
    )
  }
  return buildRetryFixPrompt(
    context.concept,
    errorMessage,
    currentCode,
    attempt,
    context.outputMode,
    context.promptOverrides
  )
}

export function buildContextOriginalPrompt(
  concept: string,
  sceneDesign: string,
  outputMode: 'video' | 'image',
  promptOverrides?: PromptOverrides
): string {
  const seed = generateSeed(concept)
  return buildInitialPrompt(concept, seed, sceneDesign, outputMode, promptOverrides)
}
