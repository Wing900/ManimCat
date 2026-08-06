import { getStudioAgentSystemPrompt } from '../prompts/agent-prompt-loader'
import type { StudioRenderContext, StudioSession } from '../domain/types'
import { getStudioModeDefinition } from '../modes/studio-mode'
import { getStudioExecutionPolicy } from './studio-execution-policy'

interface BuildStudioAgentSystemPromptInput {
  session: StudioSession
  renderContext?: StudioRenderContext
  documentationContext?: string
}

/**
 * 构建 Studio Agent 的系统提示词
 */
export function buildStudioAgentSystemPrompt(input: BuildStudioAgentSystemPromptInput): string {
  const studioKind = input.session.studioKind ?? 'manim'
  const mode = getStudioModeDefinition(studioKind)
  const policy = getStudioExecutionPolicy(studioKind)
  const renderGuardText = studioKind === 'plot'
    ? 'Plot Studio 中 write/edit/apply_patch 完成后自动触发 render，不要手动调用。'
    : '渲染是最后一步。代码必须先写入工作目录并完成 static-check，才能渲染。'
  const sections = [
    getStudioAgentSystemPrompt(input.session.agentType, studioKind),
    `当前 Studio 模式：${mode.label}。`,
    `模式目标：${mode.runtimeSummary}`,
    `文档上下文命名空间：${mode.documentationKey}。`,
    `当前运行环境：ManimCat ${policy.studioLabel}。`,
    policy.runtimeSummary,
    ...policy.builderRules,
    `工作目录：${input.session.directory}`,
    renderGuardText,
  ]

  const renderContextText = formatRenderContext(input.renderContext)
  if (renderContextText) {
    sections.push('', '<studio_render_context>', renderContextText, '</studio_render_context>')
  }

  const documentationContext = input.documentationContext?.trim()
  if (documentationContext) {
    sections.push('', '<studio_documentation>', documentationContext, '</studio_documentation>')
  }

  return sections.join('\n').trim()
}

function formatRenderContext(renderContext?: StudioRenderContext): string {
  if (!renderContext) {
    return ''
  }

  const lines: string[] = [
    `session_id: ${renderContext.sessionId}`,
    `agent: ${renderContext.agent}`
  ]

  if (renderContext.latestRender) {
    lines.push(
      `latest_render_id: ${renderContext.latestRender.id}`,
      `latest_render_status: ${renderContext.latestRender.status}`,
      `latest_render_time: ${new Date(renderContext.latestRender.timestamp).toISOString()}`
    )
    if (renderContext.latestRender.error) {
      lines.push(`latest_render_error: ${renderContext.latestRender.error}`)
    }
  }

  return lines.join('\n')
}
