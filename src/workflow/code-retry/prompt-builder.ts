import { getSharedModule, getRoleSystemPrompt, getRoleUserPrompt } from '../../prompts'
import type { PromptOverrides } from '../../types'
import type { CodeRetryContext } from './types'

function applyPromptTemplate(
  template: string,
  values: Record<string, string | boolean>,
  promptOverrides?: PromptOverrides
): string {
  let output = template

  output = output.replace(/\{\{apiIndexModule\}\}/g, getSharedModule('apiIndex', promptOverrides))
  output = output.replace(/\{\{sharedSpecification\}\}/g, getSharedModule('specification', promptOverrides))

  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value))
  }
  return output
}

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
  promptOverrides?: PromptOverrides
): string {
  return getRoleUserPrompt(
    'codeRetry',
    {
      concept,
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
  const override = context.promptOverrides?.roles?.codeRetry?.user
  if (override) {
    return applyPromptTemplate(
      override,
      {
        concept: context.concept,
        errorMessage,
        code: currentCode,
        codeSnippet: codeSnippet || '',
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
    codeSnippet,
    attempt,
    context.outputMode,
    context.promptOverrides
  )
}
