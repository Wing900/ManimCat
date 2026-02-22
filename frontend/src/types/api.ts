// API 类型定义

/** 视频质量选项 */
export type Quality = 'low' | 'medium' | 'high';
export type OutputMode = 'video' | 'image';

/** 图片细节级别 */
export type VisionImageDetail = 'auto' | 'low' | 'high';

/** 参考图片 */
export interface ReferenceImage {
  url: string;
  detail?: VisionImageDetail;
}

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

/** 角色类型 */
export type RoleType = 'conceptDesigner' | 'codeGeneration' | 'codeRetry' | 'codeEdit';

/** 共享模块类型 */
export type SharedModuleType = 'knowledge' | 'rules';

/** 提示词默认值（从服务端获取） */
export interface PromptDefaults {
  roles: Record<RoleType, { system: string; user: string }>;
  shared: Record<SharedModuleType, string>;
}

/** 提示词覆盖配置（用户自定义） */
export interface PromptOverrides {
  roles?: Partial<Record<RoleType, { system?: string; user?: string }>>;
  shared?: Partial<Record<SharedModuleType, string>>;
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
  outputMode: OutputMode;
  quality?: Quality;
  /** 参考图片 */
  referenceImages?: ReferenceImage[];
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
  outputMode: OutputMode;
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
  output_mode?: OutputMode;
  video_url?: string | null;
  image_urls?: string[];
  image_count?: number;
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
