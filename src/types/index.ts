/**
 * Type Definitions
 * 全局类型定义
 */

/**
 * 视频质量选项
 */
export type VideoQuality = 'low' | 'medium' | 'high'

/**
 * 视频配置
 */
export interface VideoConfig {
  /** 默认质量 */
  quality: VideoQuality
  /** 帧率 */
  frameRate: number
}

/**
 * 任务状态
 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

/**
 * 处理阶段
 */
export type ProcessingStage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering'

/**
 * 生成类型
 */
export type GenerationType = 'template' | 'ai' | 'cached'

/**
 * 自定义 API 配置
 */
export interface CustomApiConfig {
  apiUrl: string
  apiKey: string
  model: string
}

/**
 * Prompt overrides for generation stages
 */
export interface PromptOverrides {
  system?: {
    conceptDesigner?: string
    codeGeneration?: string
    codeRetry?: string
  }
  user?: {
    conceptDesigner?: string
    codeGeneration?: string
    codeRetryInitial?: string
    codeRetryFix?: string
  }
}

/**
 * 视频生成任务数据
 */
export interface VideoJobData {
  jobId: string
  concept: string
  quality: VideoQuality
  forceRefresh?: boolean
  timestamp: string
  /** 预生成的代码（使用自定义 AI 时） */
  preGeneratedCode?: string
  /** 自定义 API 配置（用于代码修复） */
  customApiConfig?: CustomApiConfig
  /** 视频配置 */
  videoConfig?: VideoConfig
}

/**
 * 任务结果 - 完成状态
 */
export interface CompletedJobResult {
  status: 'completed'
  data: {
    videoUrl: string
    manimCode: string
    usedAI: boolean
    quality: VideoQuality
    generationType: GenerationType
    renderPeakMemoryMB?: number
  }
  timestamp: number
}

/**
 * 任务结果 - 失败状态
 */
export interface FailedJobResult {
  status: 'failed'
  data: {
    error: string
    details?: string
    cancelReason?: string
  }
  timestamp: number
}

/**
 * 任务结果联合类型
 */
export type JobResult = CompletedJobResult | FailedJobResult

/**
 * 概念缓存数据
 */
export interface ConceptCacheData {
  jobId: string
  conceptHash: string
  concept: string
  quality: VideoQuality
  videoUrl: string
  manimCode: string
  generationType: GenerationType
  usedAI: boolean
  createdAt: number
}

/**
 * API 请求 - 生成视频
 */
export interface GenerateRequest {
  concept: string
  quality?: VideoQuality
  forceRefresh?: boolean
  promptOverrides?: PromptOverrides
}

/**
 * API 响应 - 生成视频
 */
export interface GenerateResponse {
  success: boolean
  jobId: string
  message: string
  status: 'processing'
}

/**
 * API 响应 - 任务状态（处理中）
 */
export interface JobStatusProcessingResponse {
  status: 'processing' | 'queued'
  jobId: string
  stage: ProcessingStage
  message: string
}

/**
 * API 响应 - 任务状态（完成）
 * 与前端 api.ts JobResult 类型兼容
 */
export interface JobStatusCompletedResponse {
  status: 'completed'
  jobId: string
  success: true
  video_url: string
  code: string
  used_ai: boolean
  render_quality: VideoQuality
  generation_type: GenerationType
  render_peak_memory_mb?: number
}

/**
 * API 响应 - 任务状态（失败）
 * 与前端 api.ts JobResult 类型兼容
 */
export interface JobStatusFailedResponse {
  status: 'failed'
  jobId: string
  success: false
  error: string
  details?: string
  cancel_reason?: string
}

/**
 * API 响应 - 任务状态联合类型
 */
export type JobStatusResponse =
  | JobStatusProcessingResponse
  | JobStatusCompletedResponse
  | JobStatusFailedResponse

/**
 * API 响应 - 健康检查
 */
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

/**
 * API 错误响应
 */
export interface ErrorResponse {
  error: string
  details?: string
  statusCode?: number
}

/**
 * Bull 任务进度数据
 */
export interface JobProgress {
  step: string
  percentage: number
  message?: string
}

/**
 * Manim 渲染选项
 */
export interface ManimRenderOptions {
  quality: VideoQuality
  concept: string
  code: string
  jobId: string
}

/**
 * 缓存查询结果
 */
export interface CacheCheckResult {
  hit: boolean
  data?: ConceptCacheData
}
