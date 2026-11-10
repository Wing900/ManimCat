import type { BrowserRenderPreparedPayload, OutputMode, RenderTarget } from '../../../../types'

export interface RenderResult {
  jobId: string
  concept: string
  outputMode: OutputMode
  /** Cloud jobs keep the existing media path; browser jobs carry a prepared payload. */
  renderTarget?: RenderTarget
  browserRender?: BrowserRenderPreparedPayload
  code: string
  codeLanguage?: 'python' | 'manim-python'
  usedAI: boolean
  generationType: string
  quality: string
  videoUrl?: string
  hardsubUrl?: string
  imageUrls?: string[]
  imageCount?: number
  workspaceVideoPath?: string
  workspaceImagePaths?: string[]
  renderPeakMemoryMB?: number
}
