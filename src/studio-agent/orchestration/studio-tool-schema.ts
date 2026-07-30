import type OpenAI from 'openai'
import type { StudioAgentType, StudioKind } from '../domain/types'
import type { StudioToolRegistry } from '../tools/registry'

/**
 * 工具参数 schema 定义
 * 用于 OpenAI 函数调用的参数验证
 */
const TOOL_PARAMETER_SCHEMAS: Record<string, Record<string, unknown>> = {
  read: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to read.' }
    },
    required: ['path'],
    additionalProperties: false
  },
  glob: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern such as src/**/*.ts.' },
      path: { type: 'string', description: 'Optional base directory inside the workspace.' }
    },
    required: ['pattern'],
    additionalProperties: false
  },
  grep: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Literal text to search for.' },
      path: { type: 'string', description: 'Optional base directory inside the workspace.' }
    },
    required: ['query'],
    additionalProperties: false
  },
  ls: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative directory to list.' }
    },
    additionalProperties: false
  },
  write: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to write.' },
      content: { type: 'string', description: 'Full file content.' }
    },
    required: ['path', 'content'],
    additionalProperties: false
  },
  edit: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to edit.' },
      search: { type: 'string', description: 'Exact text to replace.' },
      replace: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Replace every match when true.' }
    },
    required: ['path', 'search', 'replace'],
    additionalProperties: false
  },
  apply_patch: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to patch.' },
      patches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            replace: { type: 'string' },
            replaceAll: { type: 'boolean' }
          },
          required: ['search', 'replace'],
          additionalProperties: false
        },
        minItems: 1
      }
    },
    required: ['path', 'patches'],
    additionalProperties: false
  },
  question: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Direct clarification question for the user.' },
      details: { type: 'string', description: 'Optional context explaining why the question is needed.' }
    },
    required: ['question'],
    additionalProperties: false
  },
  'static-check': {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to check.' },
      outputMode: {
        type: 'string',
        enum: ['video', 'image'],
        description: 'Render mode used for static checks.'
      }
    },
    required: ['path'],
    additionalProperties: false
  },
  render: {
    type: 'object',
    properties: {
      concept: { type: 'string', description: 'Render task summary.' },
      code: { type: 'string', description: 'Render code for the current studio. In Manim Studio this is Manim code; in Plot Studio this is matplotlib Python code.' },
      outputMode: {
        type: 'string',
        enum: ['video', 'image'],
        description: 'Requested render output.'
      },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Render quality.'
      }
    },
    required: ['concept', 'code'],
    additionalProperties: false
  }
}

/**
 * Plot Studio 的渲染参数 schema（简化版）
 */
const PLOT_RENDER_PARAMETER_SCHEMA: Record<string, Record<string, unknown>> = {
  render: {
    type: 'object',
    properties: {
      concept: { type: 'string', description: 'Static plot task summary.' },
      code: { type: 'string', description: 'Matplotlib Python code to execute for Plot Studio.' }
    },
    required: ['concept', 'code'],
    additionalProperties: false
  }
}

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
      parameters: resolveToolParameterSchema(tool.name, studioKind) ?? {
        type: 'object',
        additionalProperties: true
      }
    }
  }))
}

/**
 * 解析工具参数 schema，根据 Studio 类型选择不同的 schema
 * @param toolName - 工具名称
 * @param studioKind - Studio 类型
 * @returns 工具参数 schema
 */
function resolveToolParameterSchema(toolName: string, studioKind?: StudioKind) {
  if (studioKind === 'plot') {
    return PLOT_RENDER_PARAMETER_SCHEMA[toolName] ?? TOOL_PARAMETER_SCHEMAS[toolName]
  }

  return TOOL_PARAMETER_SCHEMAS[toolName]
}
