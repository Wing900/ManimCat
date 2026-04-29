import { getStudioAgentSystemPrompt } from '../prompts/agent-prompt-loader'
import type { StudioSession, StudioWorkContext } from '../domain/types'
import { getStudioExecutionPolicy } from './studio-execution-policy'
import type {
  StudioResolvedSkill,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary
} from '../skills/schema/skill-types'

interface BuildStudioAgentSystemPromptInput {
  session: StudioSession
  workContext?: StudioWorkContext
  availableSkills?: StudioSkillDiscoveryEntry[]
  skillSummaries?: StudioSkillUsageSummary[]
  activeSkills?: StudioResolvedSkill[]
}

/**
 * 构建 Studio Agent 的系统提示词
 * @param input - 包含会话、工作上下文、可用技能和技能摘要的输入对象
 * @returns 完整的系统提示词字符串
 */
export function buildStudioAgentSystemPrompt(input: BuildStudioAgentSystemPromptInput): string {
  const studioKind = input.session.studioKind ?? 'manim'
  const policy = getStudioExecutionPolicy(studioKind)
  const renderGuardText = studioKind === 'plot'
    ? 'Plot Studio 中 write/edit/apply_patch 完成后自动触发 render，不要手动调用。'
    : '渲染是最后一步。代码必须先写入工作目录并完成 static-check，才能渲染。'
  const sections = [
    getStudioAgentSystemPrompt(input.session.agentType, studioKind),
    `当前运行环境：ManimCat ${policy.studioLabel}。`,
    policy.runtimeSummary,
    ...policy.builderRules,
    `工作目录：${input.session.directory}`,
    renderGuardText,
    '子代理工作使用 task 工具。代码审查优先使用 ai-review 或 reviewer 子代理。',
    '只在用户明确按名称请求时才调用 skill 工具。skill 激活后按其指引执行，不要重复加载。',
    '如果激活的 skill 引用了外部文件，在需要时读取它们。',
  ]

  const workContextText = formatWorkContext(input.workContext)
  if (workContextText) {
    sections.push('', '<studio_work_context>', workContextText, '</studio_work_context>')
  }

  const skillCatalogText = formatSkillCatalog(input.availableSkills)
  if (skillCatalogText) {
    sections.push('', '<studio_skill_catalog>', skillCatalogText, '</studio_skill_catalog>')
  }

  const skillSummaryText = formatSkillSummaries(input.skillSummaries)
  if (skillSummaryText) {
    sections.push('', '<studio_skill_state>', skillSummaryText, '</studio_skill_state>')
  }

  const loadedSkillText = formatLoadedSkills(input.activeSkills)
  if (loadedSkillText) {
    sections.push('', '<studio_loaded_skill>', loadedSkillText, '</studio_loaded_skill>')
  }

  return sections.join('\n').trim()
}

/**
 * 格式化工作上下文信息
 * @param workContext - 工作上下文对象
 * @returns 格式化的上下文文本
 */
function formatWorkContext(workContext?: StudioWorkContext): string {
  if (!workContext) {
    return ''
  }

  const lines: string[] = [
    `session_id: ${workContext.sessionId}`,
    `agent: ${workContext.agent}`
  ]

  if (workContext.currentWork) {
    lines.push(
      `current_work: ${workContext.currentWork.title}`,
      `current_work_type: ${workContext.currentWork.type}`,
      `current_work_status: ${workContext.currentWork.status}`
    )
  }

  if (workContext.lastRender) {
    lines.push(
      `last_render_status: ${workContext.lastRender.status}`,
      `last_render_time: ${new Date(workContext.lastRender.timestamp).toISOString()}`
    )
    if (workContext.lastRender.error) {
      lines.push(`last_render_error: ${workContext.lastRender.error}`)
    }
  }

  if (workContext.lastStaticCheck?.issues.length) {
    lines.push(`last_static_check_issue_count: ${workContext.lastStaticCheck.issues.length}`)
  }

  if (workContext.fileChanges?.length) {
    lines.push('recent_file_changes:')
    for (const change of workContext.fileChanges.slice(0, 20)) {
      lines.push(`- ${change.status} ${change.path}`)
    }
  }

  return lines.join('\n')
}

/**
 * 格式化可用技能目录
 * @param skills - 技能发现条目数组
 * @returns 格式化的技能目录文本
 */
function formatSkillCatalog(skills?: StudioSkillDiscoveryEntry[]): string {
  if (!skills?.length) {
    return ''
  }

  const lines = [
    '可用 skill 列表仅供参考。只有用户明确按名称请求时才加载。'
  ]

  for (const skill of skills) {
    const suffix: string[] = []
    if (skill.scope) {
      suffix.push(`scope=${skill.scope}`)
    }
    if (skill.tags?.length) {
      suffix.push(`tags=${skill.tags.join(',')}`)
    }
    lines.push(`- ${skill.name}: ${skill.description}${suffix.length ? ` (${suffix.join('; ')})` : ''}`)
  }

  return lines.join('\n')
}

/**
 * 格式化技能使用摘要
 * @param summaries - 技能使用摘要数组
 * @returns 格式化的技能使用摘要文本
 */
function formatSkillSummaries(summaries?: StudioSkillUsageSummary[]): string {
  if (!summaries?.length) {
    return ''
  }

  return summaries
    .slice(-10)
    .map((summary) => {
      const parts = [`- ${summary.skillName}`]
      if (summary.reason) {
        parts.push(`reason=${summary.reason}`)
      }
      if (summary.takeaway) {
        parts.push(`takeaway=${summary.takeaway}`)
      }
      if (typeof summary.stillRelevant === 'boolean') {
        parts.push(`still_relevant=${summary.stillRelevant ? 'yes' : 'no'}`)
      }
      return parts.join(' | ')
    })
    .join('\n')
}

/**
 * Format active (loaded) skills for system prompt injection.
 * Injects the full 5-layer content of each active skill.
 */
function formatLoadedSkills(skills?: StudioResolvedSkill[]): string {
  if (!skills?.length) {
    return ''
  }

  const sections: string[] = []

  for (const skill of skills) {
    const parts: string[] = [`# Skill: ${skill.name}`]

    if (skill.layers) {
      if (skill.layers.role) {
        parts.push('', '## Role', skill.layers.role)
      }
      if (skill.layers.workflow) {
        parts.push('', '## Workflow', skill.layers.workflow)
      }
      if (skill.layers.construction) {
        parts.push('', '## Construction', skill.layers.construction)
      }
      if (skill.layers.style) {
        parts.push('', '## Style', skill.layers.style)
      }
      if (skill.layers.shotHint) {
        parts.push('', '## Shot', skill.layers.shotHint)
      }
    } else {
      // Fallback: use raw body if layers not parsed
      parts.push('', skill.body.trim())
    }

    parts.push('', `基础目录：${skill.directory}`)

    // Inject shot examples if available
    if (skill.shots?.length) {
      parts.push('', '## Shot 示例（临时 — 首次渲染成功后自动丢弃）')
      for (const shot of skill.shots) {
        parts.push('', `### ${shot.name}`, shot.content.trim())
      }
    }

    sections.push(parts.join('\n'))
  }

  return sections.join('\n\n')
}
