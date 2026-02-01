/**
 * Type Definitions
 * 鍏ㄥ眬绫诲瀷瀹氫箟
 */

/**
 * 瑙嗛璐ㄩ噺閫夐」
 */
export type VideoQuality = 'low' | 'medium' | 'high'

/**
 * 瑙嗛閰嶇疆
 */
export interface VideoConfig {
  /** 榛樿璐ㄩ噺 */
  quality: VideoQuality
  /** 甯х巼 */
  frameRate: number
}

/**
 * 浠诲姟鐘舵€?
 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

/**
 * 澶勭悊闃舵
 */
export type ProcessingStage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering'

/**
 * 鐢熸垚绫诲瀷
 */
export type GenerationType = 'template' | 'ai' | 'cached'

/**
 * 鑷畾涔?API 閰嶇疆
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
    codeEdit?: string
  }
  user?: {
    conceptDesigner?: string
    codeGeneration?: string
    codeRetryInitial?: string
    codeRetryFix?: string
    codeEdit?: string
  }
}

/**
 * 瑙嗛鐢熸垚浠诲姟鏁版嵁
 */
export interface VideoJobData {
  jobId: string
  concept: string
  quality: VideoQuality
  forceRefresh?: boolean
  timestamp: string
  /** 棰勭敓鎴愮殑浠ｇ爜锛堜娇鐢ㄨ嚜瀹氫箟 AI 鏃讹級 */
  preGeneratedCode?: string
  /** AI 淇敼鏃剁殑鍘熷浠ｇ爜 */
  editCode?: string
  /** AI 淇敼鏃剁殑鐢ㄦ埛鎸囦护 */
  editInstructions?: string
  /** 鑷畾涔?API 閰嶇疆锛堢敤浜庝唬鐮佷慨澶嶏級 */
  customApiConfig?: CustomApiConfig
  /** 瑙嗛閰嶇疆 */
  videoConfig?: VideoConfig
  /** Prompt 覆盖 */
  promptOverrides?: PromptOverrides
}

/**
 * 浠诲姟缁撴灉 - 瀹屾垚鐘舵€?
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
 * 浠诲姟缁撴灉 - 澶辫触鐘舵€?
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
 * 浠诲姟缁撴灉鑱斿悎绫诲瀷
 */
export type JobResult = CompletedJobResult | FailedJobResult

/**
 * 姒傚康缂撳瓨鏁版嵁
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
 * API 璇锋眰 - 鐢熸垚瑙嗛
 */
export interface GenerateRequest {
  concept: string
  quality?: VideoQuality
  forceRefresh?: boolean
  promptOverrides?: PromptOverrides
}

/**
 * API 璇锋眰 - AI 淇敼
 */
export interface ModifyRequest {
  concept: string
  quality?: VideoQuality
  instructions: string
  code: string
  promptOverrides?: PromptOverrides
  videoConfig?: VideoConfig
  customApiConfig?: CustomApiConfig
}

/**
 * API 鍝嶅簲 - 鐢熸垚瑙嗛
 */
export interface GenerateResponse {
  success: boolean
  jobId: string
  message: string
  status: 'processing'
}

/**
 * API 鍝嶅簲 - 浠诲姟鐘舵€侊紙澶勭悊涓級
 */
export interface JobStatusProcessingResponse {
  status: 'processing' | 'queued'
  jobId: string
  stage: ProcessingStage
  message: string
}

/**
 * API 鍝嶅簲 - 浠诲姟鐘舵€侊紙瀹屾垚锛?
 * 涓庡墠绔?api.ts JobResult 绫诲瀷鍏煎
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
 * API 鍝嶅簲 - 浠诲姟鐘舵€侊紙澶辫触锛?
 * 涓庡墠绔?api.ts JobResult 绫诲瀷鍏煎
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
 * API 鍝嶅簲 - 浠诲姟鐘舵€佽仈鍚堢被鍨?
 */
export type JobStatusResponse =
  | JobStatusProcessingResponse
  | JobStatusCompletedResponse
  | JobStatusFailedResponse

/**
 * API 鍝嶅簲 - 鍋ュ悍妫€鏌?
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
 * API 閿欒鍝嶅簲
 */
export interface ErrorResponse {
  error: string
  details?: string
  statusCode?: number
}

/**
 * Bull 浠诲姟杩涘害鏁版嵁
 */
export interface JobProgress {
  step: string
  percentage: number
  message?: string
}

/**
 * Manim 娓叉煋閫夐」
 */
export interface ManimRenderOptions {
  quality: VideoQuality
  concept: string
  code: string
  jobId: string
}

/**
 * 缂撳瓨鏌ヨ缁撴灉
 */
export interface CacheCheckResult {
  hit: boolean
  data?: ConceptCacheData
}

