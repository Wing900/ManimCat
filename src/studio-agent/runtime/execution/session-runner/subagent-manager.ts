import { resolveStudioToolChoice } from '../../session/session-agent-config'
import { buildSubagentPrompt } from '../session-runner-helpers'
import type { StudioSubagentRunRequest, StudioSubagentRunResult } from '../../tools/tool-runtime-context'
import type { StudioSessionRunnerDependencies } from './dependency-center'

export async function runSubagent(
  deps: Pick<StudioSessionRunnerDependencies, 'resolveSkill'>,
  input: StudioSubagentRunRequest,
  run: (input: {
    projectId: string
    session: StudioSubagentRunRequest['childSession']
    inputText: string
    customApiConfig?: StudioSubagentRunRequest['customApiConfig']
    toolChoice?: StudioSubagentRunRequest['toolChoice']
  }) => Promise<{ text: string }>,
): Promise<StudioSubagentRunResult> {
  const skill = input.skillName && deps.resolveSkill
    ? await deps.resolveSkill(input.skillName, input.childSession)
    : undefined

  const result = await run({
    projectId: input.projectId,
    session: input.childSession,
    inputText: buildSubagentPrompt({
      agentType: input.subagentType,
      inputText: input.inputText,
      skillName: input.skillName,
      skill,
      files: input.files,
      studioKind: input.childSession.studioKind
    }),
    customApiConfig: input.customApiConfig,
    toolChoice: input.toolChoice ?? resolveStudioToolChoice({ session: input.childSession })
  })

  return {
    text: result.text
  }
}
