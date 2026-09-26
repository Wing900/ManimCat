import { RuntimeManimApiProvider, type ManimApiProvider } from '../../services/manim-api'
import { ManimKnowledgeAdapter } from './manim-knowledge-adapter'
import { MatplotlibKnowledgeAdapter } from './matplotlib/matplotlib-knowledge-adapter'
import type { MatplotlibCatalogLoader } from './matplotlib/runtime-matplotlib-catalog'
import { StudioKnowledgeRouter } from './studio-knowledge-router'
import type { StudioKnowledgeProvider } from './studio-knowledge-types'

/**
 * Production Knowledge composition: Manim reuses the Runtime Manim Catalog provider,
 * Plot uses the lazy Matplotlib Runtime Catalog adapter. Instantiate once at module
 * scope (runtime/runtime-service.ts) so the caches remain effective across tool calls.
 *
 * The Matplotlib catalog is loaded on first lookup, so constructing this provider
 * never starts Python.
 */
export function createDefaultStudioKnowledgeProvider(input?: {
  manimApiProvider?: ManimApiProvider
  plotKnowledgeProvider?: StudioKnowledgeProvider
  plotCatalogLoader?: MatplotlibCatalogLoader
}): StudioKnowledgeProvider {
  return new StudioKnowledgeRouter({
    adapters: {
      manim: new ManimKnowledgeAdapter(input?.manimApiProvider ?? new RuntimeManimApiProvider()),
      plot: input?.plotKnowledgeProvider
        ?? new MatplotlibKnowledgeAdapter(input?.plotCatalogLoader)
    }
  })
}
