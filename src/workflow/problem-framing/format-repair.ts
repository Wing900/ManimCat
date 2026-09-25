import {
  parseProblemFramingResponse,
  ProblemFramingFormatError,
  type ProblemFramingPlan,
} from './parser'
import type { PromptLocale } from '../../types'

interface ProblemFramingFormatRepairOptions {
  content: string
  locale: PromptLocale
  maxRepairAttempts: number
  repair: (input: {
    content: string
    error: string
    attempt: number
  }) => Promise<string>
}

export async function parseProblemFramingWithRepair(
  options: ProblemFramingFormatRepairOptions,
): Promise<ProblemFramingPlan> {
  let content = options.content
  let lastError: ProblemFramingFormatError | undefined

  for (let attempt = 0; attempt <= options.maxRepairAttempts; attempt += 1) {
    try {
      return parseProblemFramingResponse(content, options.locale)
    } catch (error) {
      if (!(error instanceof ProblemFramingFormatError)) {
        throw error
      }
      lastError = error
      if (attempt >= options.maxRepairAttempts) {
        break
      }
      content = await options.repair({
        content,
        error: error.message,
        attempt: attempt + 1,
      })
    }
  }

  throw lastError || new ProblemFramingFormatError('Unable to parse problem framing response')
}
