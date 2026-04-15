import type { StudioCommandContext, StudioSkillCommand } from '../types'

export async function executeStudioSkillCommand(
  command: StudioSkillCommand,
  context: StudioCommandContext,
) {
  await context.runCommandInput(command.raw)
}
