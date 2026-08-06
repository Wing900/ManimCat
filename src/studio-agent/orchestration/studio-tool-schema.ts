import type OpenAI from 'openai'
import type { StudioAgentType, StudioKind } from '../domain/types'
import type { StudioToolRegistry } from '../tools/registry'

/**
 * 构建 Studio 聊天工具 schema，用于 OpenAI 函数调用
 * @param registry - 工具注册表
 * @param agentType - 代理类型
 * @param studioKind - Studio 类型
 * @returns OpenAI 聊天完成工具数组
 */
export function buildStudioChatTools(
  registry: StudioToolRegistry,
  agentType: StudioAgentType,
  studioKind?: StudioKind
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return registry.listForAgent(agentType, studioKind).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }
  }))
}
