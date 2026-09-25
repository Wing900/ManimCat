import { createLogger } from '../../utils/logger'
import type { ManimApiProvider } from '../manim-api'
import type { ChatMessage, CodePatchSet, RetryCheckpoint } from './types'
import { parseCodeRetryAction } from './action-parser'

const logger = createLogger('CodeRetrySession')

interface RepairTurnResult {
  content: string | null | undefined
  mode: string
}

interface RepairSessionOptions {
  messages: ChatMessage[]
  apiProvider: ManimApiProvider
  requestTurn: (messages: ChatMessage[], turn: number) => Promise<RepairTurnResult>
  concept: string
  attempt: number
  onCheckpoint?: RetryCheckpoint
}

export interface RepairSessionResult {
  patchSet: CodePatchSet
  mode: string
  turn: number
}

export async function runRepairSession(options: RepairSessionOptions): Promise<RepairSessionResult> {
  const { messages, apiProvider, requestTurn, concept, attempt, onCheckpoint } = options
  let turn = 0

  while (true) {
    turn += 1
    if (onCheckpoint) {
      await onCheckpoint()
    }

    const { content, mode } = await requestTurn(messages, turn)
    if (!content) {
      throw new Error('AI returned empty content')
    }

    logger.info('Code retry model response received', {
      concept,
      attempt,
      turn,
      mode,
      contentLength: content.length,
      contentPreview: content.trim().slice(0, 500)
    })

    const action = parseCodeRetryAction(content)
    if (action.type === 'patch') {
      return { patchSet: action.patchSet, mode, turn }
    }

    const result = await apiProvider.lookup(action.request)
    logger.info('Code retry API request resolved', {
      attempt,
      turn,
      status: result.status,
      cached: result.cached,
      symbols: result.symbols
    })
    messages.push({ role: 'assistant', content })
    messages.push({
      role: 'user',
      content: `[[API_RESULT]]\n${result.content}\n[[END]]\nReturn the next API_REQUEST or the final PATCH.`
    })
  }
}
