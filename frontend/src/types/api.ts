// API 类型定义

/** 视频质量选项 */
export type Quality = 'low' | 'medium' | 'high';

/** API 配置 */
export interface ApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  manimcatApiKey: string;
}

export interface CustomApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface PromptOverrides {
  system?: {
    conceptDesigner?: string;
    codeGeneration?: string;
    codeRetry?: string;
    codeEdit?: string;
  };
  user?: {
    conceptDesigner?: string;
    codeGeneration?: string;
    codeRetryInitial?: string;
    codeRetryFix?: string;
    codeEdit?: string;
  };
}

/** 视频配置 */
export interface VideoConfig {
  /** 默认质量 */
  quality: Quality;
  /** 帧率 */
  frameRate: number;
  /** 超时时间（秒），默认 600 秒（10 分钟） */
  timeout?: number;
}

/** 设置配置 */
export interface SettingsConfig {
  api: ApiConfig;
  video: VideoConfig;
}

/** 任务状态 */
export type JobStatus = 'processing' | 'completed' | 'failed';

/** 处理阶段 */
export type ProcessingStage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering';

export interface JobTimings {
  cache?: number;
  analyze?: number;
  edit?: number;
  retry?: number;
  render?: number;
  store?: number;
  total?: number;
}

/** 生成请求 */
export interface GenerateRequest {
  concept: string;
  quality?: Quality;
  forceRefresh?: boolean;
  /** 预生成的代码（使用自定义 AI 时） */
  code?: string;
  /** 视频配置 */
  videoConfig?: VideoConfig;
  /** Prompt overrides */
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
}

/** AI 修改请求 */
export interface ModifyRequest {
  concept: string;
  quality?: Quality;
  instructions: string;
  code: string;
  videoConfig?: VideoConfig;
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
}

/** 生成响应 */
export interface GenerateResponse {
  success: boolean;
  jobId: string;
  message: string;
  status: JobStatus;
}

/** 任务结果 */
export interface JobResult {
  jobId: string;
  status: JobStatus;
  stage?: ProcessingStage;
  message?: string;
  success?: boolean;
  video_url?: string;
  code?: string;
  used_ai?: boolean;
  render_quality?: string;
  generation_type?: string;
  render_peak_memory_mb?: number;
  timings?: JobTimings;

  error?: string;
  details?: string;
  cancel_reason?: string;
}

/** API 错误 */
export interface ApiError {
  error: string;
}
