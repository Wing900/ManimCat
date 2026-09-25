import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { cleanManimCode } from '../../utils/manim-code-cleaner'
import { getClient } from './client'
import type { ChatMessage, CodeRetryContext, RetryCheckpoint } from './types'
import { buildRetryPrompt, getCodeRetrySystemPrompt } from './prompt-builder'
import { dedupeSharedBlocksInMessages } from '../prompt-dedup'
import { createChatCompletionText } from '../openai-stream'
import { buildTokenParams } from '../../utils/reasoning-model'
import { applyPatchSetToCode, extractTargetLine } from './utils'
import { RuntimeManimApiProvider } from '../manim-api'
import { runRepairSession } from './repair-session'
import { inferAutomaticApiRequests } from './api-hints'

const logger = createLogger('CodeRetryCodeGen')

const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '12000', 10)
const THINKING_TOKENS = parseInt(process.env.AI_THINKING_TOKENS || '20000', 10)

function getModel(customApiConfig?: unknown): string {
  const model = (customApiConfig as { model?: string } | undefined)?.model
  const trimmed = model?.trim() || ''
  if (!trimmed) {
    throw new Error('No model available')
  }
  return trimmed
}

export async function retryCodeGeneration(
  context: CodeRetryContext,
  errorMessage: string,
  attempt: number,
  currentCode: string,
  codeSnippet: string | undefined,
  customApiConfig?: unknown,
  onCheckpoint?: RetryCheckpoint
): Promise<string> {
  const client = getClient(customApiConfig as any)
  if (!client) {
    throw new Error('No upstream AI is configured for this request')
  }

  const retryPrompt = buildRetryPrompt(context, errorMessage, attempt, currentCode, codeSnippet)
  const apiProvider = new RuntimeManimApiProvider()

  try {
    const automaticRequests = inferAutomaticApiRequests(currentCode, errorMessage)
    const automaticResults = await Promise.all(
      automaticRequests.map((request) => apiProvider.lookup(request))
    )
    const automaticApiContext = automaticResults.length > 0
      ? `\n\n[[AUTOMATIC_API_CONTEXT]]\n${automaticResults
          .map((result) => result.content)
          .join('\n\n---\n\n')}\n[[END]]\nUse this runtime-verified context. If it is insufficient, return an API_REQUEST.`
      : ''

    logger.info('Automatic retry API context resolved', {
      attempt,
      requests: automaticRequests.map((request) => request.symbols[0]),
      statuses: automaticResults.map((result) => result.status)
    })

    const requestMessages: ChatMessage[] = dedupeSharedBlocksInMessages(
      [
        { role: 'system', content: getCodeRetrySystemPrompt(context.promptOverrides) },
        { role: 'user', content: `${retryPrompt}${automaticApiContext}` }
      ],
      context.promptOverrides
    )

    const session = await runRepairSession({
      messages: requestMessages,
      apiProvider,
      concept: context.concept,
      attempt,
      onCheckpoint,
      requestTurn: (messages, turn) => createChatCompletionText(
        client,
        {
          model: getModel(customApiConfig),
          messages,
          temperature: AI_TEMPERATURE,
          ...buildTokenParams(THINKING_TOKENS, MAX_TOKENS)
        },
        { fallbackToNonStream: true, usageLabel: `retry-${attempt}-turn-${turn}` }
      )
    })

    const patchedCode = applyPatchSetToCode(
      currentCode,
      session.patchSet,
      extractTargetLine(errorMessage)
    )
    const cleaned = cleanManimCode(patchedCode)

    logger.info('Code retry patch applied', {
      concept: context.concept,
      attempt,
      turn: session.turn,
      mode: session.mode,
      patchCount: session.patchSet.patches.length,
      codeLength: cleaned.code.length,
      patchLengths: session.patchSet.patches.map((patch) => ({
        originalSnippetLength: patch.originalSnippet.length,
        replacementSnippetLength: patch.replacementSnippet.length
      })),
      codePreview: cleaned.code.slice(0, 500)
    })

    return cleaned.code
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API error during code retry', {
        attempt,
        status: error.status,
        message: error.message
      })
    }
    throw error
  }
}
