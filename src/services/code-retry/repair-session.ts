import { createLogger } from '../../utils/logger'
import type { ApiCatalogPackage, ApiRagService } from '../api-rag'
import type { ChatMessage, CodePatchSet, RetryCheckpoint } from './types'
import { parseCodeRetryAction } from './action-parser'

const logger = createLogger('CodeRetrySession')

interface RepairTurnResult {
  content: string | null | undefined
  mode: string
}

interface RepairSessionOptions {
  messages: ChatMessage[]
  /** The same process-wide service the Studio Builder tool uses. */
  apiRagService: ApiRagService
  packageName: ApiCatalogPackage
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
  const { messages, apiRagService, packageName, requestTurn, concept, attempt, onCheckpoint } = options
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

    const result = await apiRagService.search(packageName, action.request)
    logger.info('Code retry API request resolved', {
      attempt,
      turn,
      query: result.query,
      verified: result.verification.filter((entry) => entry.verdict === 'FOUND').length,
      candidates: result.candidates.length
    })
    messages.push({ role: 'assistant', content })
    messages.push({
      role: 'user',
      content: `[[API_RESULT]]\n${JSON.stringify(result, null, 2)}\n[[END]]\nReturn the next API_REQUEST or the final PATCH.`
    })
  }
}
