export type StudioToolParameters = Record<string, unknown>

export const readToolParameters: StudioToolParameters = {
  type: 'object',
  properties: { path: { type: 'string', description: 'Workspace-relative file path to read.' } },
  required: ['path'],
  additionalProperties: false,
}

export const globToolParameters: StudioToolParameters = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'Glob pattern such as src/**/*.ts.' },
    path: { type: 'string', description: 'Optional base directory inside the workspace.' },
  },
  required: ['pattern'],
  additionalProperties: false,
}

export const grepToolParameters: StudioToolParameters = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Literal text to search for.' },
    path: { type: 'string', description: 'Optional base directory inside the workspace.' },
  },
  required: ['query'],
  additionalProperties: false,
}

export const lsToolParameters: StudioToolParameters = {
  type: 'object',
  properties: { path: { type: 'string', description: 'Workspace-relative directory to list.' } },
  additionalProperties: false,
}

export const writeToolParameters: StudioToolParameters = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Workspace-relative file path to write.' },
    content: { type: 'string', description: 'Full file content.' },
  },
  required: ['path', 'content'],
  additionalProperties: false,
}

export const editToolParameters: StudioToolParameters = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Workspace-relative file path to edit.' },
    search: { type: 'string', description: 'Exact text to replace.' },
    replace: { type: 'string', description: 'Replacement text.' },
    replaceAll: { type: 'boolean', description: 'Replace every match when true.' },
  },
  required: ['path', 'search', 'replace'],
  additionalProperties: false,
}

export const applyPatchToolParameters: StudioToolParameters = {
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
          replaceAll: { type: 'boolean' },
        },
        required: ['search', 'replace'],
        additionalProperties: false,
      },
      minItems: 1,
    },
  },
  required: ['path', 'patches'],
  additionalProperties: false,
}

export const staticCheckToolParameters: StudioToolParameters = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Workspace-relative file path to check.' },
    outputMode: { type: 'string', enum: ['video', 'image'] },
  },
  required: ['path'],
  additionalProperties: false,
}

export const manimRenderToolParameters: StudioToolParameters = {
  type: 'object',
  properties: {
    concept: { type: 'string', description: 'Render task summary.' },
    code: { type: 'string', description: 'Manim Python code to execute.' },
    outputMode: { type: 'string', enum: ['video', 'image'] },
    quality: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['concept', 'code'],
  additionalProperties: false,
}

export const plotRenderToolParameters: StudioToolParameters = {
  type: 'object',
  properties: {
    concept: { type: 'string', description: 'Static plot task summary.' },
    code: { type: 'string', description: 'Matplotlib Python code to execute.' },
  },
  required: ['concept', 'code'],
  additionalProperties: false,
}
