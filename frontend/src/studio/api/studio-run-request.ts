import type { StudioCreateRunInput, StudioSession } from '../protocol/studio-agent-types'
import { requireStudioProviderConfig } from './studio-provider-config'

interface BuildStudioRunRequestInput {
  session: StudioSession
  inputText: string
}

export function buildStudioCreateRunInput(input: BuildStudioRunRequestInput): StudioCreateRunInput {
  return {
    sessionId: input.session.id,
    inputText: input.inputText,
    projectId: input.session.projectId,
    customApiConfig: requireStudioProviderConfig(),
  }
}
