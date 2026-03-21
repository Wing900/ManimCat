import { getStudioAgentSystemPrompt } from '../prompts/agent-prompt-loader'
import type { StudioSession, StudioWorkContext } from '../domain/types'

interface BuildStudioAgentSystemPromptInput {
  session: StudioSession
  workContext?: StudioWorkContext
}

export function buildStudioAgentSystemPrompt(input: BuildStudioAgentSystemPromptInput): string {
  const sections = [
    getStudioAgentSystemPrompt(input.session.agentType),
    'You are running inside ManimCat Studio.',
    'Use tools directly when they are needed. Do not invent tool results or claim work was done unless the tool actually completed.',
    'Prefer the smallest safe next action. Read before editing when the target file is not already known.',
    'When you have enough information and no tool is needed, answer normally in plain text.',
    'If user clarification is truly required, call the question tool instead of guessing.',
    'For subagent work, use the task tool. For local skills, use the skill tool. For code review, prefer ai-review or reviewer subagent when appropriate.',
    'The render tool already inherits the current provider chain from Studio. Do not ask the user to pass provider config inside tool arguments.'
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
