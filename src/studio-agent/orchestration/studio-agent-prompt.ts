import { getStudioAgentSystemPrompt } from '../prompts/agent-prompt-loader'
import type { StudioKind, StudioRenderContext, StudioSession } from '../domain/types'
import {
  isSceneRunExecutionScope,
  truncateSceneDirectory,
  type StudioRunExecutionScope,
  type StudioSceneRunExecutionScope
} from '../domain/run-execution-scope'
import { getStudioModeDefinition } from '../modes/studio-mode'

interface BuildStudioAgentSystemPromptInput {
  session: StudioSession
  renderContext?: StudioRenderContext
  /**
   * Scope of the Run. A Scene scope adds the bounded `<studio_scene_scope>` block; a Legacy scope
   * adds nothing, so its prompt stays byte-for-byte unchanged.
   */
  executionScope?: StudioRunExecutionScope
}

/**
 * 构建 Studio Agent 的系统提示词：最小 Builder Core + 结构化场景事实。
 */
export function buildStudioAgentSystemPrompt(input: BuildStudioAgentSystemPromptInput): string {
  const studioKind: StudioKind = input.session.studioKind ?? 'manim'
  const sections = [
    getStudioAgentSystemPrompt(input.session.agentType, studioKind),
    formatStudioScene(input.session, studioKind),
  ]

  const scopeText = formatStudioSceneScope(input.executionScope)
  if (scopeText) {
    sections.push('', '<studio_scene_scope>', scopeText, '</studio_scene_scope>')
  }

  const renderContextText = formatRenderContext(input.renderContext)
  if (renderContextText) {
    sections.push('', '<studio_render_context>', renderContextText, '</studio_render_context>')
  }

  return sections.join('\n').trim()
}

/**
 * 以事实形式描述当前场景能力，不承载领域教程或执行配方。
 */
function formatStudioScene(session: StudioSession, studioKind: StudioKind): string {
  const mode = getStudioModeDefinition(studioKind)
  const automaticRenderAfter = mode.autoRenderAfterTools.length
    ? mode.autoRenderAfterTools.join(', ')
    : 'none'

  return [
    '<studio_scene>',
    `kind: ${studioKind}`,
    `label: ${mode.label}`,
    `runtime: ${mode.runtimeSummary}`,
    `language: ${mode.codeLanguage}`,
    `outputs: ${mode.outputModes.join(', ')}`,
    `workspace: ${session.directory}`,
    `automatic_render_after: ${automaticRenderAfter}`,
    '</studio_scene>',
  ].join('\n')
}

/**
 * Bounded, privacy-safe description of the Scene write/read boundary. Relative paths only: no
 * owner identifier, no absolute filesystem path, and never source content. A capped directory is
 * marked explicitly so the model can tell truncation from a complete list.
 */
function formatStudioSceneScope(executionScope?: StudioRunExecutionScope): string {
  if (!executionScope || !isSceneRunExecutionScope(executionScope)) {
    return ''
  }

  const scope: StudioSceneRunExecutionScope = executionScope
  const directory = truncateSceneDirectory(scope.scenes)
  const lines: string[] = [
    `current_scene_id: ${scope.sceneId}`,
    `current_source: ${scope.currentSourceRelativePath}`,
    'write_scope: current_source_only',
    'read_scope: session_workspace',
    'scene_directory:',
    ...directory.entries.map((entry) =>
      `- position: ${entry.position}; id: ${entry.id}; source: ${entry.sourceRelativePath}; current: ${entry.isCurrent}`
    ),
  ]

  if (directory.truncated) {
    lines.push(`scene_directory_truncated: true; omitted_count: ${directory.omittedCount}`)
  }

  return lines.join('\n')
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
