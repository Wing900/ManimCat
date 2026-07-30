import { getStudioAgentSystemPrompt } from '../prompts/agent-prompt-loader'
import type { StudioSession, StudioWorkContext } from '../domain/types'
import { getStudioExecutionPolicy } from './studio-execution-policy'

interface BuildStudioAgentSystemPromptInput {
  session: StudioSession
  workContext?: StudioWorkContext
}

/**
 * 构建 Studio Agent 的系统提示词
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
  ]

  const workContextText = formatWorkContext(input.workContext)
  if (workContextText) {
    sections.push('', '<studio_work_context>', workContextText, '</studio_work_context>')
  }

  return sections.join('\n').trim()
}

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