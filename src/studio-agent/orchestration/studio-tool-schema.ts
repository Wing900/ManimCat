import type OpenAI from 'openai'
import type { StudioAgentType } from '../domain/types'
import type { StudioToolRegistry } from '../tools/registry'

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
  task: {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        enum: ['reviewer', 'designer'],
        description: 'Child agent role.'
      },
      description: { type: 'string', description: 'Short child task title.' },
      input: { type: 'string', description: 'Detailed instruction for the child agent.' },
      skill: { type: 'string', description: 'Optional local skill to load.' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relevant workspace-relative files.'
      }
    },
    required: ['subagent_type', 'description', 'input'],
    additionalProperties: false
  },
  skill: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Local Studio skill name.' }
    },
    required: ['name'],
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
  'ai-review': {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to review.' },
      text: { type: 'string', description: 'Inline text to review when no path is provided.' },
      before: { type: 'string', description: 'Optional pre-change content.' },
      after: { type: 'string', description: 'Optional post-change content.' },
      diff: { type: 'string', description: 'Optional unified diff for change-set review.' }
    },
    additionalProperties: false
  },
  render: {
    type: 'object',
    properties: {
      concept: { type: 'string', description: 'Render task summary.' },
      code: { type: 'string', description: 'Manim code to render.' },
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

export function buildStudioChatTools(
  registry: StudioToolRegistry,
  agentType: StudioAgentType
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return registry.listForAgent(agentType).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: TOOL_PARAMETER_SCHEMAS[tool.name] ?? {
        type: 'object',
        additionalProperties: true
      }
    }
  }))
}
