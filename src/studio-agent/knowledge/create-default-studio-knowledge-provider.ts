import { RuntimeManimApiProvider, type ManimApiProvider } from '../../services/manim-api'
import { ManimKnowledgeAdapter } from './manim-knowledge-adapter'
import { StudioKnowledgeRouter } from './studio-knowledge-router'
import { createUnavailableStudioKnowledgeProvider } from './unavailable-studio-knowledge-provider'
import type { StudioKnowledgeProvider } from './studio-knowledge-types'

export const MATPLOTLIB_KNOWLEDGE_SOURCE = 'matplotlib-runtime-catalog'

/**
 * Production Knowledge composition: Manim reuses the Runtime Manim Catalog provider,
 * Plot stays unavailable until the Matplotlib adapter lands. Instantiate once at
 * module scope so the Runtime Manim cache remains effective across tool calls.
 */
export function createDefaultStudioKnowledgeProvider(input?: {
  manimApiProvider?: ManimApiProvider
}): StudioKnowledgeProvider {
  return new StudioKnowledgeRouter({
    adapters: {
      manim: new ManimKnowledgeAdapter(input?.manimApiProvider ?? new RuntimeManimApiProvider()),
      plot: createUnavailableStudioKnowledgeProvider({
        source: MATPLOTLIB_KNOWLEDGE_SOURCE,
        reason: 'Matplotlib runtime catalog lookup is not available in this build.'
      })
    }
  })
}
