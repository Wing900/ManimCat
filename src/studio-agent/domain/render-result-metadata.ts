import type { JobResult } from '../../types'

export interface StudioSharedRenderMetadata {
  taskId?: string
  jobId?: string
  renderId?: string
  studioKind?: 'manim' | 'plot'
  outputMode?: string
  quality?: string
  generationType?: string
  usedAI?: boolean
  renderPeakMemoryMB?: number
  timings?: unknown
  code?: string
  codeLanguage?: 'python' | 'manim-python'
  workspaceVideoPath?: string
  workspaceImagePaths?: string[]
  imageCount?: number
  scriptPath?: string
  stdout?: string
  stderr?: string
  error?: string
  details?: string
  cancelReason?: string
  stage?: unknown
  bullStatus?: unknown
}

export function resolveJobResultCode(result: Extract<JobResult, { status: 'completed' }>): string | undefined {
  return result.data.code
}

export function resolveJobResultCodeLanguage(result: Extract<JobResult, { status: 'completed' }>): 'python' | 'manim-python' | undefined {
  if (result.data.codeLanguage === 'python' || result.data.codeLanguage === 'manim-python') {
    return result.data.codeLanguage
  }

  return result.data.outputMode === 'video' || result.data.videoUrl ? 'manim-python' : undefined
}
