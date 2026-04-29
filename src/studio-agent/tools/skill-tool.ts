import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import { logPlotStudioSkillTrace } from '../observability/plot-studio-skill-trace'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'

interface SkillToolInput {
  name: string
}

export function createStudioSkillTool(): StudioToolDefinition<SkillToolInput> {
  return {
    name: 'skill',
    description: 'Activate a Studio skill. The skill content will be injected into the system prompt for subsequent steps.',
    category: 'agent',
    permission: 'skill',
    allowedAgents: ['builder', 'reviewer', 'designer'],
    requiresTask: false,
    execute: async (input, context) => executeSkillTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeSkillTool(
  input: SkillToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  if (!context.resolveSkill) {
    throw new Error('Skill tool requires a skill resolver')
  }

  logPlotStudioSkillTrace(context.session.studioKind, 'skill.tool.called', {
    sessionId: context.session.id,
    runId: context.run.id,
    requestedSkillName: input.name,
    agentType: context.session.agentType,
  })

  const skill = await context.resolveSkill(input.name, context.session)
  const title = `Activated skill: ${skill.name}`

  // Persist to ActiveSkillStore so system prompt includes it on next step
  context.activeSkillStore?.set(context.session.id, skill)

  await context.recordSkillUsage?.({
    session: context.session,
    skillName: skill.name,
    reason: 'Skill was activated in the current session.',
    takeaway: skill.description,
    stillRelevant: true
  })

  context.setToolMetadata?.({
    title,
    metadata: {
      skillName: skill.name,
      directory: skill.directory,
      entryFile: skill.entryFile,
      scope: skill.scope,
      tags: skill.tags
    }
  })

  logPlotStudioSkillTrace(context.session.studioKind, 'skill.tool.completed', {
    sessionId: context.session.id,
    runId: context.run.id,
    requestedSkillName: input.name,
    resolvedSkillName: skill.name,
    entryFile: skill.entryFile,
    scope: skill.scope,
  })

  const layerSummary = skill.layers
    ? `Layers: Role, Workflow, Construction, Style${skill.shots?.length ? `, ${skill.shots.length} shot(s)` : ''}.`
    : ''

  return {
    title,
    output: [
      `Skill "${skill.name}" is now active.`,
      `Description: ${skill.description}`,
      layerSummary,
      `Base directory: ${skill.directory}`,
      'The full skill content is injected into the system prompt for subsequent steps.',
    ].filter(Boolean).join('\n'),
    metadata: {
      skillName: skill.name,
      directory: skill.directory,
      entryFile: skill.entryFile,
      scope: skill.scope,
      tags: skill.tags
    }
  }
}
