import type { CustomApiConfig } from '../../../../types'
import { buildDraftAssistantMessage, buildDraftRun } from '../session-runner-helpers'
import type { StudioAssistantMessage, StudioRun, StudioSession } from '../../../domain/types'
import type { StudioSessionRunnerDependencies } from './dependency-center'

export async function createAssistantMessage(
  deps: Pick<StudioSessionRunnerDependencies, 'messageStore'>,
  session: StudioSession,
  /** Scene scope of the owning Run; absent for a Legacy Run. */
  sceneId?: string,
  /** ISO of the Run's user message; the assistant message is stamped strictly after it. */
  notBefore?: string,
): Promise<StudioAssistantMessage> {
  // The `runId` slot of the draft helper stays untouched: this path has never propagated it and
  // Task 11B2A must not change message metadata behavior.
  const message = buildDraftAssistantMessage(session, undefined, sceneId, notBefore)
  return deps.messageStore.createAssistantMessage(message)
}

export function createRun(
  session: StudioSession,
  inputText: string,
  metadata?: Record<string, unknown>,
  sceneId?: string,
): StudioRun {
  return buildDraftRun(session, inputText, metadata, sceneId)
}

export function hasUsableCustomApiConfig(config?: CustomApiConfig): config is CustomApiConfig {
  if (!config) {
    return false
  }

  return [config.apiUrl, config.apiKey, config.model].every((value) => typeof value === 'string' && value.trim().length > 0)
}
