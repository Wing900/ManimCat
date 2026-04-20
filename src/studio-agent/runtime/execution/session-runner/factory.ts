import type { CustomApiConfig } from '../../../../types'
import { buildDraftAssistantMessage, buildDraftRun } from '../session-runner-helpers'
import type { StudioAssistantMessage, StudioRun, StudioSession } from '../../../domain/types'
import type { StudioSessionRunnerDependencies } from './dependency-center'

export async function createAssistantMessage(
  deps: Pick<StudioSessionRunnerDependencies, 'messageStore'>,
  session: StudioSession,
  runId?: string,
): Promise<StudioAssistantMessage> {
  const message = buildDraftAssistantMessage(session, runId)
  return deps.messageStore.createAssistantMessage(message)
}

export function createRun(
  session: StudioSession,
  inputText: string,
  metadata?: Record<string, unknown>,
): StudioRun {
  return buildDraftRun(session, inputText, metadata)
}

export function hasUsableCustomApiConfig(config?: CustomApiConfig): config is CustomApiConfig {
  if (!config) {
    return false
  }

  return [config.apiUrl, config.apiKey, config.model].every((value) => typeof value === 'string' && value.trim().length > 0)
}
