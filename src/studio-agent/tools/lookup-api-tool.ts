import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { STUDIO_KNOWLEDGE_LIMITS } from '../knowledge/studio-knowledge-request'
import { lookupStudioKnowledge } from '../knowledge/studio-knowledge-lookup'
import { createUnavailableStudioKnowledgeProvider } from '../knowledge/unavailable-studio-knowledge-provider'
import type { StudioKnowledgeProvider } from '../knowledge/studio-knowledge-types'
import { lookupApiToolParameters } from './tool-parameters'

export const LOOKUP_API_TOOL_NAME = 'lookup-api'

interface LookupApiToolInput {
  query: string
  symbols?: string[]
}

export function createStudioLookupApiTool(provider?: StudioKnowledgeProvider): StudioToolDefinition<LookupApiToolInput> {
  const knowledgeProvider = provider ?? createUnavailableStudioKnowledgeProvider()

  return {
    name: LOOKUP_API_TOOL_NAME,
    parameters: lookupApiToolParameters,
    description: 'Look up verified APIs for the current Studio runtime.',
    allowedAgents: ['builder'],
    execute: async (input, context) => executeLookupApiTool(
      input,
      context as StudioRuntimeBackedToolContext,
      knowledgeProvider
    )
  }
}

async function executeLookupApiTool(
  input: LookupApiToolInput,
  context: StudioRuntimeBackedToolContext,
  provider: StudioKnowledgeProvider
): Promise<StudioToolResult> {
  // The Studio kind comes from the session, never from model input.
  const kind = context.session.studioKind ?? 'manim'
  const result = await lookupStudioKnowledge(provider, {
    kind,
    query: input?.query,
    symbols: input?.symbols ?? [],
    maxChars: STUDIO_KNOWLEDGE_LIMITS.maxContentChars
  })

  // lookupStudioKnowledge is the single authoritative bounding layer: content is already
  // sliced to the requested bound and truncation truth is computed there.
  return {
    title: `API lookup: ${kind}`,
    output: result.content,
    metadata: {
      status: result.status,
      source: result.source,
      query: result.query,
      symbols: result.symbols,
      cached: result.cached,
      truncated: result.truncated
    }
  }
}
