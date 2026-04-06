import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tool-runtime-context'

interface SkillToolInput {
  name: string
}

export function createStudioSkillTool(): StudioToolDefinition<SkillToolInput> {
  return {
    name: 'skill',
    description: 'Load a local Studio skill into the current run context.',
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

  await context.ask?.({
    permission: 'skill',
    patterns: [input.name],
    metadata: {
      skill: input.name
    }
  })

  const skill = await context.resolveSkill(input.name, context.session)
  const title = `Loaded skill: ${skill.name}`

  await context.recordSkillUsage?.({
    session: context.session,
    skillName: skill.name,
    reason: 'Skill was loaded into the current run.',
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

  return {
    title,
    output: [
      `<skill_content name="${skill.name}">`,
      `# Skill: ${skill.name}`,
      '',
      skill.body.trim(),
      '',
      `Base directory for this skill: ${skill.directory}`,
      'Relative paths in this skill (for example scripts/ or reference/) are resolved from this directory.',
      '',
      '<skill_files>',
      skill.files.map((file) => `<file>${file}</file>`).join('\n'),
      '</skill_files>',
      '</skill_content>'
    ].join('\n'),
    metadata: {
      skillName: skill.name,
      directory: skill.directory,
      entryFile: skill.entryFile,
      scope: skill.scope,
      tags: skill.tags
    }
  }
}
