import { getStudioAgentSystemPrompt } from '../prompts/agent-prompt-loader'
import type { StudioSession, StudioWorkContext } from '../domain/types'
import { getStudioExecutionPolicy } from './studio-execution-policy'

interface BuildStudioAgentSystemPromptInput {
  session: StudioSession
  workContext?: StudioWorkContext
}

export function buildStudioAgentSystemPrompt(input: BuildStudioAgentSystemPromptInput): string {
  const studioKind = input.session.studioKind ?? 'manim'
  const policy = getStudioExecutionPolicy(studioKind)
  const renderGuardText = studioKind === 'plot'
    ? 'For builder work, render is a finalization step. Do not call render until the target code has been written or updated in the workspace. Use static-check only when the code is unusually complex, the risk is high, or repeated failures suggest it is needed.'
    : 'For builder work, render is a finalization step. Do not call render until the target code has been written or updated in the workspace and checked with static-check.'
  const renderBlockerText = studioKind === 'plot'
    ? 'If the target code is missing, requirements are unclear, or there are unresolved issues that still need edits, stop and ask instead of rendering.'
    : 'If there are unresolved static-check issues, missing files, or unclear requirements, stop and ask instead of rendering.'
  const sections = [
    getStudioAgentSystemPrompt(input.session.agentType, studioKind),
    `You are running inside ManimCat ${policy.studioLabel}.`,
    policy.runtimeSummary,
    ...policy.builderRules,
    `Workspace root: ${input.session.directory}`,
    'Use tools directly when they are needed. Do not invent tool results or claim work was done unless the tool actually completed.',
    'Prefer the smallest safe next action. Read before editing when the target file is not already known.',
    'All workspace tools operate relative to the workspace root unless a tool explicitly says otherwise.',
    renderGuardText,
    'If the user asks for rendering but has not yet confirmed the exact code/file to render, summarize the planned render target and use the question tool to ask for confirmation first.',
    renderBlockerText,
    'When repairing an existing file after a render failure, prefer the smallest local edit or apply_patch change that fixes the issue. Do not rewrite the whole file unless the file is tiny or the change is genuinely broad.',
    'If the task is not finished, do not end the turn without a tool call. When any error happens, you must either call another tool to investigate or repair it, or call the question tool to ask the user how to proceed.',
    'Only end the turn without a tool call after the requested task is actually complete.',
    'When you have enough information and no tool is needed, answer normally in plain text.',
    'Never finish the turn with empty assistant text. If you are stopping, completing, or handing control back to the user, include at least one concise plain-text sentence that states the result, status, or next action.',
    'Keep replies compact and readable. Respond in plain text, not Markdown.',
    'Do not use markdown bold markers such as **text**, do not use backticks or inline code formatting, and do not use fenced code blocks.',
    'Avoid decorative formatting, heading markers, and excessive blank lines.',
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
