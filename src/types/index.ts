/**
 * Shared application types.
 */

export type VideoQuality = 'low' | 'medium' | 'high'
export type OutputMode = 'video' | 'image'
export type PromptLocale = 'zh-CN' | 'en-US'

/**
 * Video render configuration.
 */
export interface VideoConfig {
  quality: VideoQuality
  frameRate: number
  timeout?: number
  bgm?: boolean
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type ProcessingStage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering'

/**
 * Per-stage timing stats in milliseconds.
 */
export interface JobTimings {
  analyze?: number
  edit?: number
  retry?: number
  render?: number
  store?: number
  total?: number
}

export type GenerationType = 'template' | 'ai' | 'cached'

/**
 * User-supplied API provider override.
 */
export interface CustomApiConfig {
  apiUrl: string
  apiKey: string
  model: string
}

/**
 * Prompt overrides for generation stages.
 */
export interface PromptOverrides {
  locale?: PromptLocale
  roles?: Partial<Record<'problemFraming' | 'conceptDesigner' | 'codeGeneration' | 'codeRetry' | 'codeEdit', { system?: string; user?: string }>>
  shared?: Partial<Record<'apiIndex' | 'specification', string>>
}

export type VisionImageDetail = 'auto' | 'low' | 'high'

export interface ReferenceImage {
  url: string
  detail?: VisionImageDetail
}

export interface ProblemFramingStep {
  title: string
  content: string
}

export interface ProblemFramingPlan {
  mode: 'clarify' | 'invent'
  headline: string
  summary: string
  steps: ProblemFramingStep[]
  visualMotif: string
  designerHint: string
}

/**
 * Queue payload for a render job.
 */
export interface VideoJobData {
  jobId: string
  concept: string
  problemPlan?: ProblemFramingPlan
  referenceImages?: ReferenceImage[]
  quality: VideoQuality
  outputMode: OutputMode
  timestamp: string
  clientId?: string
  preGeneratedCode?: string
  editCode?: string
  editInstructions?: string
  customApiConfig?: CustomApiConfig
  videoConfig?: VideoConfig
  promptOverrides?: PromptOverrides
  workspaceDirectory?: string
  renderCacheKey?: string
}

/**
 * Final successful job result.
 */
export interface CompletedJobResult {
  status: 'completed'
  data: {
    outputMode: OutputMode
    videoUrl?: string
    imageUrls?: string[]
    imageCount?: number
    workspaceVideoPath?: string
    workspaceImagePaths?: string[]
    code?: string
    codeLanguage?: 'python' | 'manim-python'
    usedAI: boolean
    quality: VideoQuality
    generationType: GenerationType
    renderPeakMemoryMB?: number
    timings?: JobTimings
  }
  timestamp: number
}

/**
 * Final failed job result.
 */
export interface FailedJobResult {
  status: 'failed'
  data: {
    error: string
    details?: string
    cancelReason?: string
    outputMode?: OutputMode
  }
  timestamp: number
}

export type JobResult = CompletedJobResult | FailedJobResult

/**
 * Cached completed render metadata.
 */
export interface ConceptCacheData {
  jobId: string
  conceptHash: string
  concept: string
  quality: VideoQuality
  outputMode?: OutputMode
  videoUrl: string
  code: string
  generationType: GenerationType
  usedAI: boolean
  createdAt: number
}

export interface GenerateRequest {
  concept: string
  problemPlan?: ProblemFramingPlan
  referenceImages?: ReferenceImage[]
  quality?: VideoQuality
  outputMode: OutputMode
  promptOverrides?: PromptOverrides
  customApiConfig?: CustomApiConfig
  renderCacheKey?: string
}

export interface ModifyRequest {
  concept: string
  quality?: VideoQuality
  instructions: string
  code: string
  promptOverrides?: PromptOverrides
  videoConfig?: VideoConfig
  customApiConfig?: CustomApiConfig
  renderCacheKey?: string
}

export interface GenerateResponse {
  success: boolean
  jobId: string
  message: string
  status: 'processing'
  submittedAt: string
}

export interface JobStatusProcessingResponse {
  status: 'processing' | 'queued'
  jobId: string
  stage: ProcessingStage
  message: string
  submitted_at?: string
  updated_at?: string
  revision: number
  attempt: number
}

/**
 * API response shape for a completed job.
 */
export interface JobStatusCompletedResponse {
  status: 'completed'
  jobId: string
  success: true
  submitted_at?: string
  finished_at?: string
  updated_at?: string
  revision: number
  attempt: number
  output_mode: OutputMode
  video_url?: string | null
  image_urls?: string[]
  image_count?: number
  code: string
  used_ai: boolean
  render_quality: VideoQuality
  generation_type: GenerationType
  render_peak_memory_mb?: number
  timings?: JobTimings
}

/**
 * API response shape for a failed job.
 */
export interface JobStatusFailedResponse {
  status: 'failed'
  jobId: string
  success: false
  submitted_at?: string
  finished_at?: string
  updated_at?: string
  revision: number
  attempt: number
  error: string
  details?: string
  cancel_reason?: string
}

export type JobStatusResponse =
  | JobStatusProcessingResponse
  | JobStatusCompletedResponse
  | JobStatusFailedResponse

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down'
  timestamp: string
  services: {
    redis: boolean
    queue: boolean
    openai: boolean
  }
  stats?: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
    total: number
  }
}

export interface ErrorResponse {
  error: string
  details?: string
  statusCode?: number
}

export interface JobProgress {
  step: string
  percentage: number
  message?: string
}

export interface ManimRenderOptions {
  quality: VideoQuality
  concept: string
  code: string
  jobId: string
}

export interface CacheCheckResult {
  hit: boolean
  data?: ConceptCacheData
}
